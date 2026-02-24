require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const app = express();
const puerto = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- 1. CONEXIÓN A BASE DE DATOS (MONGODB) ---
// Asegúrate de tener la variable MONGO_URI en tu archivo .env o en Render
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Conectado a MongoDB Atlas'))
    .catch(err => console.error('❌ Error conectando a BD:', err));

// --- 2. DEFINICIÓN DE MODELOS (ESQUEMAS) ---

// Modelo de Producto
const productoSchema = new mongoose.Schema({
    id: { type: Number, unique: true }, // Mantenemos tu ID numérico
    nombre: String,
    precio: Number,
    categoria: String,
    stock: Number,
    imagen: String
});
const Producto = mongoose.model('Producto', productoSchema);

// Modelo de Venta
const ventaSchema = new mongoose.Schema({
    id: { type: Number, unique: true }, // ID basado en Date.now()
    fecha: String,
    cliente: String,
    tipo: String,
    items: Array, // Guardamos el carrito tal cual
    total: Number,
    pagado: Number,
    deuda: Number,
    estado: String
});
const Venta = mongoose.model('Venta', ventaSchema);


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

app.get('/api/productos', async (req, res) => {
    try {
        const productos = await Producto.find().sort({ id: 1 });
        res.json(productos);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener productos' });
    }
});

app.post('/api/productos', async (req, res) => {
    try {
        // Lógica para mantener tu ID autoincremental manual
        const ultimoProducto = await Producto.findOne().sort({ id: -1 });
        const nuevoId = ultimoProducto ? ultimoProducto.id + 1 : 1;

        const nuevoProducto = new Producto({
            id: nuevoId,
            ...req.body
        });
        
        await nuevoProducto.save();
        res.json({ mensaje: "Producto guardado", producto: nuevoProducto });
    } catch (error) {
        res.status(500).json({ error: 'Error guardando producto' });
    }
});

app.put('/api/productos/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const actualizado = await Producto.findOneAndUpdate({ id: id }, req.body, { new: true });
        
        if (actualizado) {
            res.json({ mensaje: "Producto actualizado", producto: actualizado });
        } else {
            res.status(404).json({ mensaje: "Producto no encontrado" });
        }
    } catch (error) {
        res.status(500).json({ error: 'Error actualizando' });
    }
});

app.delete('/api/productos/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        await Producto.findOneAndDelete({ id: id });
        res.json({ mensaje: "Producto eliminado" });
    } catch (error) {
        res.status(500).json({ error: 'Error eliminando' });
    }
});

// --- RUTAS DE VENTAS Y CRÉDITOS (POS) ---

// Registrar Nueva Venta
app.post('/api/nueva-venta', async (req, res) => {
    const { cliente, carrito, tipo, pagoRealizado } = req.body; 
    let totalTransaccion = 0;
    
    try {
        // 1. Validar Stock y Calcular Total (Iteramos sobre el carrito)
        for (let item of carrito) {
            const prod = await Producto.findOne({ id: item.id });
            
            if (!prod) return res.status(400).json({ mensaje: `Producto no encontrado: ${item.nombre}` });
            if (prod.stock < item.cantidad) return res.status(400).json({ mensaje: `Stock insuficiente: ${item.nombre}` });
            
            // Restar stock en BD
            prod.stock -= item.cantidad;
            await prod.save();
            
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
                estado = pagoRealizado == 0 ? 'Debe' : 'Parcial';
            }
        }

        // 3. Crear Venta
        const nuevaVenta = new Venta({
            id: Date.now(), // ID basado en tiempo como tenías antes
            fecha: new Date().toLocaleString(),
            cliente: cliente || (tipo === 'donacion' ? "Beneficiario" : "Cliente"),
            tipo: tipo,
            items: carrito,
            total: totalTransaccion,
            pagado: tipo === 'donacion' ? 0 : Number(pagoRealizado),
            deuda: Number(deuda),
            estado: estado
        });

        await nuevaVenta.save();
        res.json({ mensaje: "Venta registrada" });

    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: "Error procesando la venta" });
    }
});

// Abonar a deuda
app.post('/api/abonar', async (req, res) => {
    const { idVenta, montoAbono } = req.body;

    try {
        const venta = await Venta.findOne({ id: idVenta });
        if (!venta) return res.status(404).json({ mensaje: "Venta no encontrada" });

        if (montoAbono > venta.deuda) return res.status(400).json({ mensaje: "El abono supera la deuda" });

        // Actualizamos valores
        venta.pagado = Number(venta.pagado) + Number(montoAbono);
        venta.deuda = Number(venta.deuda) - Number(montoAbono);

        if (venta.deuda <= 0) {
            venta.deuda = 0;
            venta.estado = 'Pagado';
        } else {
            venta.estado = 'Parcial';
        }

        await venta.save();
        res.json({ mensaje: "Abono registrado" });

    } catch (error) {
        res.status(500).json({ mensaje: "Error al abonar" });
    }
});

// --- GESTIÓN DE HISTORIAL (EDITAR Y ELIMINAR CON STOCK) ---

app.get('/api/ventas', async (req, res) => {
    try {
        const ventas = await Venta.find().sort({ id: -1 }); // Ordenar por más reciente
        res.json(ventas);
    } catch (error) {
        res.status(500).json({ error: 'Error obteniendo ventas' });
    }
});

// Editar Venta (Recalcula stock y dinero)
app.put('/api/ventas/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    const { cliente, total, pagado, items } = req.body; // Items nuevos
    
    try {
        const ventaAnterior = await Venta.findOne({ id: id });
        if (!ventaAnterior) return res.status(404).json({ mensaje: "Venta no encontrada" });

        // 1. DEVOLVER STOCK ORIGINAL (Revertir la venta vieja)
        if (ventaAnterior.items && ventaAnterior.items.length > 0) {
            for (let itemViejo of ventaAnterior.items) {
                const prod = await Producto.findOne({ id: itemViejo.id });
                if (prod) {
                    prod.stock += Number(itemViejo.cantidad);
                    await prod.save();
                }
            }
        }

        // 2. RESTAR NUEVO STOCK (Aplicar la venta corregida)
        if (items && items.length > 0) {
            for (let itemNuevo of items) {
                const prod = await Producto.findOne({ id: itemNuevo.id });
                if (prod) {
                    prod.stock -= Number(itemNuevo.cantidad);
                    await prod.save();
                }
            }
        }

        // 3. ACTUALIZAR DATOS DE LA VENTA
        const nuevoTotal = Number(total);
        const nuevoPagado = Number(pagado);
        const nuevaDeuda = nuevoTotal - nuevoPagado;
        
        let nuevoEstado = ventaAnterior.estado;
        if (ventaAnterior.tipo === 'donacion') {
            nuevoEstado = 'Donación';
        } else {
            if (nuevaDeuda <= 0) nuevoEstado = 'Pagado';
            else if (nuevoPagado == 0) nuevoEstado = 'Debe';
            else nuevoEstado = 'Parcial';
        }

        // Actualizamos el documento
        ventaAnterior.cliente = cliente;
        ventaAnterior.items = items;
        ventaAnterior.total = nuevoTotal;
        ventaAnterior.pagado = nuevoPagado;
        ventaAnterior.deuda = nuevaDeuda > 0 ? nuevaDeuda : 0;
        ventaAnterior.estado = nuevoEstado;

        await ventaAnterior.save();
        res.json({ mensaje: "Venta corregida y stock ajustado" });

    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: "Error editando venta" });
    }
});

// Eliminar Venta (Devuelve stock)
app.delete('/api/ventas/:id', async (req, res) => {
    const id = parseInt(req.params.id);

    try {
        const ventaAEliminar = await Venta.findOne({ id: id });
        
        if (ventaAEliminar) {
            // Devolver productos al stock
            if(ventaAEliminar.items && ventaAEliminar.items.length > 0) {
                for (let item of ventaAEliminar.items) {
                    const prod = await Producto.findOne({ id: item.id });
                    if(prod) {
                        prod.stock += Number(item.cantidad);
                        await prod.save();
                    }
                }
            }

            // Eliminar registro de Mongo
            await Venta.deleteOne({ id: id });
            res.json({ mensaje: "Venta eliminada y stock restaurado" });
        } else {
            res.status(404).json({ mensaje: "Venta no encontrada" });
        }
    } catch (error) {
        res.status(500).json({ mensaje: "Error al eliminar venta" });
    }
});

// --- INICIAR SERVIDOR ---
app.listen(puerto, () => {
    console.log(`✅ Servidor La Bodeguita de Mara listo en puerto ${puerto}`);
});