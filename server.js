const express = require('express');
const cors = require('cors');
const fs = require('fs');
const app = express();
const puerto = process.env.PORT || 3000;
app.use(express.static('public'));

// Archivos de base de datos
const ARCHIVO_DB = 'productos.json';
const ARCHIVO_VENTAS = 'ventas.json';

// Middleware
app.use(cors());
app.use(express.json());

// --- FUNCIONES AUXILIARES ---

// Leer datos de un archivo JSON (crea el archivo si no existe)
const leerDatos = (archivo) => {
    try {
        if (!fs.existsSync(archivo)) {
            fs.writeFileSync(archivo, '[]');
            return [];
        }
        const datos = fs.readFileSync(archivo, 'utf-8');
        return JSON.parse(datos || '[]');
    } catch (error) {
        console.error(`Error leyendo ${archivo}:`, error);
        return [];
    }
};

// Guardar datos en un archivo JSON
const guardarDatos = (archivo, datos) => {
    try {
        fs.writeFileSync(archivo, JSON.stringify(datos, null, 2));
    } catch (error) {
        console.error(`Error guardando en ${archivo}:`, error);
    }
};

// --- RUTAS DE AUTENTICACIÓN ---

app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === "mara123") {
        res.json({ exito: true });
    } else {
        res.status(401).json({ exito: false });
    }
});

// --- RUTAS DE PRODUCTOS (INVENTARIO) ---

app.get('/api/productos', (req, res) => {
    const productos = leerDatos(ARCHIVO_DB);
    res.json(productos);
});

app.post('/api/productos', (req, res) => {
    let productos = leerDatos(ARCHIVO_DB);
    const nuevoId = productos.length > 0 ? Math.max(...productos.map(p => p.id)) + 1 : 1;
    const nuevoProducto = { id: nuevoId, ...req.body };
    productos.push(nuevoProducto);
    guardarDatos(ARCHIVO_DB, productos);
    res.json({ mensaje: "Producto guardado" });
});

app.put('/api/productos/:id', (req, res) => {
    const id = parseInt(req.params.id);
    let productos = leerDatos(ARCHIVO_DB);
    const index = productos.findIndex(p => p.id === id);

    if (index !== -1) {
        productos[index] = { ...productos[index], ...req.body };
        guardarDatos(ARCHIVO_DB, productos);
        res.json({ mensaje: "Producto actualizado" });
    } else {
        res.status(404).json({ mensaje: "Producto no encontrado" });
    }
});

app.delete('/api/productos/:id', (req, res) => {
    const id = parseInt(req.params.id);
    let productos = leerDatos(ARCHIVO_DB);
    const nuevosProductos = productos.filter(p => p.id !== id);
    guardarDatos(ARCHIVO_DB, nuevosProductos);
    res.json({ mensaje: "Producto eliminado" });
});

// --- RUTAS DE VENTAS Y CRÉDITOS (POS) ---

// Registrar Nueva Venta
app.post('/api/nueva-venta', (req, res) => {
    const { cliente, carrito, tipo, pagoRealizado } = req.body; 
    
    let productos = leerDatos(ARCHIVO_DB);
    let ventas = leerDatos(ARCHIVO_VENTAS);
    let totalTransaccion = 0;
    
    // 1. Validar Stock y Calcular Total
    for (let item of carrito) {
        const prod = productos.find(p => p.id == item.id);
        
        if (!prod) return res.status(400).json({ mensaje: `Producto no encontrado: ${item.nombre}` });
        if (prod.stock < item.cantidad) return res.status(400).json({ mensaje: `Stock insuficiente: ${item.nombre}` });
        
        prod.stock -= item.cantidad; // Restar stock
        
        if (tipo !== 'donacion') {
            totalTransaccion += (prod.precio * item.cantidad);
        }
    }

    // 2. Calcular Deuda
    let deuda = 0;
    let estado = 'Pagado';

    if (tipo === 'donacion') {
        deuda = 0;
        estado = 'Donación';
    } else {
        if (pagoRealizado < totalTransaccion) {
            deuda = totalTransaccion - pagoRealizado;
            estado = pagoRealizado === 0 ? 'Debe' : 'Parcial';
        }
    }

    // 3. Guardar cambios
    guardarDatos(ARCHIVO_DB, productos);

    const nuevaVenta = {
        id: Date.now(),
        fecha: new Date().toLocaleString(),
        cliente: cliente || (tipo === 'donacion' ? "Beneficiario" : "Cliente"),
        tipo: tipo,
        items: carrito,
        total: totalTransaccion,
        pagado: tipo === 'donacion' ? 0 : Number(pagoRealizado),
        deuda: Number(deuda),
        estado: estado
    };

    ventas.push(nuevaVenta);
    guardarDatos(ARCHIVO_VENTAS, ventas);

    res.json({ mensaje: "Venta registrada" });
});

// Abonar a deuda
app.post('/api/abonar', (req, res) => {
    const { idVenta, montoAbono } = req.body;
    let ventas = leerDatos(ARCHIVO_VENTAS);
    
    const index = ventas.findIndex(v => v.id === idVenta);
    if (index === -1) return res.status(404).json({ mensaje: "Venta no encontrada" });

    let venta = ventas[index];
    
    if (montoAbono > venta.deuda) return res.status(400).json({ mensaje: "El abono supera la deuda" });

    venta.pagado = Number(venta.pagado) + Number(montoAbono);
    venta.deuda = Number(venta.deuda) - Number(montoAbono);

    if (venta.deuda <= 0) {
        venta.deuda = 0;
        venta.estado = 'Pagado';
    } else {
        venta.estado = 'Parcial';
    }

    guardarDatos(ARCHIVO_VENTAS, ventas);
    res.json({ mensaje: "Abono registrado" });
});

// --- GESTIÓN DE HISTORIAL (EDITAR Y ELIMINAR CON STOCK) ---

app.get('/api/ventas', (req, res) => {
    res.json(leerDatos(ARCHIVO_VENTAS));
});

// Editar Venta (Recalcula stock y dinero)
app.put('/api/ventas/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const { cliente, total, pagado, items } = req.body; // Recibimos los items nuevos
    
    let ventas = leerDatos(ARCHIVO_VENTAS);
    let productos = leerDatos(ARCHIVO_DB);
    const index = ventas.findIndex(v => v.id === id);
    
    if (index !== -1) {
        const ventaAnterior = ventas[index];

        // 1. DEVOLVER STOCK ORIGINAL (Revertir la venta vieja)
        if (ventaAnterior.items && ventaAnterior.items.length > 0) {
            ventaAnterior.items.forEach(itemViejo => {
                const prod = productos.find(p => p.id === itemViejo.id);
                if (prod) {
                    prod.stock += Number(itemViejo.cantidad);
                }
            });
        }

        // 2. RESTAR NUEVO STOCK (Aplicar la venta corregida)
        if (items && items.length > 0) {
            items.forEach(itemNuevo => {
                const prod = productos.find(p => p.id === itemNuevo.id);
                if (prod) {
                    // Aquí no validamos error para permitir corrección forzada, 
                    // pero idealmente se validaría si stock < 0
                    prod.stock -= Number(itemNuevo.cantidad);
                }
            });
        }

        // Guardamos el stock corregido
        guardarDatos(ARCHIVO_DB, productos);

        // 3. ACTUALIZAR DATOS DE LA VENTA
        const nuevoTotal = Number(total);
        const nuevoPagado = Number(pagado);
        const nuevaDeuda = nuevoTotal - nuevoPagado;
        
        let nuevoEstado = ventaAnterior.estado;
        if (ventaAnterior.tipo === 'donacion') {
            nuevoEstado = 'Donación';
        } else {
            if (nuevaDeuda <= 0) nuevoEstado = 'Pagado';
            else if (nuevoPagado === 0) nuevoEstado = 'Debe';
            else nuevoEstado = 'Parcial';
        }

        ventas[index] = {
            ...ventaAnterior,
            cliente: cliente,
            items: items, // Actualizamos la lista de items
            total: nuevoTotal,
            pagado: nuevoPagado,
            deuda: nuevaDeuda > 0 ? nuevaDeuda : 0,
            estado: nuevoEstado
        };
        
        guardarDatos(ARCHIVO_VENTAS, ventas);
        res.json({ mensaje: "Venta corregida y stock ajustado" });
    } else {
        res.status(404).json({ mensaje: "Venta no encontrada" });
    }
});

// Eliminar Venta (Devuelve stock)
app.delete('/api/ventas/:id', (req, res) => {
    const id = parseInt(req.params.id);
    let ventas = leerDatos(ARCHIVO_VENTAS);
    let productos = leerDatos(ARCHIVO_DB);
    
    const ventaAEliminar = ventas.find(v => v.id === id);
    
    if (ventaAEliminar) {
        // Devolver productos al stock
        if(ventaAEliminar.items && ventaAEliminar.items.length > 0) {
            ventaAEliminar.items.forEach(item => {
                const prod = productos.find(p => p.id === item.id);
                if(prod) {
                    prod.stock += Number(item.cantidad);
                }
            });
            guardarDatos(ARCHIVO_DB, productos);
        }

        // Eliminar registro
        const ventasFiltradas = ventas.filter(v => v.id !== id);
        guardarDatos(ARCHIVO_VENTAS, ventasFiltradas);
        
        res.json({ mensaje: "Venta eliminada y stock restaurado" });
    } else {
        res.status(404).json({ mensaje: "Venta no encontrada" });
    }
});

// --- INICIAR SERVIDOR ---
app.listen(puerto, () => {
    console.log(`✅ Servidor La Bodeguita de Mara listo en: http://localhost:${puerto}`);
});