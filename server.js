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

// --- 1. CONEXIÓN A BASE DE DATOS ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Conectado a MongoDB Atlas'))
    .catch(err => console.error('❌ Error conectando a BD:', err));

// --- 2. MODELOS ---

const productoSchema = new mongoose.Schema({
    id: { type: Number, unique: true },
    nombre: String,
    precio: Number,
    categoria: String,
    stock: Number,
    imagen: String
});
const Producto = mongoose.model('Producto', productoSchema);

const ventaSchema = new mongoose.Schema({
    id: { type: Number, unique: true },
    fecha: String,
    cliente: String,
    tipo: String,        // 'venta', 'donacion', 'web'
    metodoPago: String,  // 'Efectivo', 'Nequi Web', 'Deuda'
    referenciaPago: String, // Número de comprobante Nequi
    items: Array,
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

// --- RUTAS DE PRODUCTOS ---

app.get('/api/productos', async (req, res) => {
    try {
        const productos = await Producto.find().sort({ nombre: 1 }); // Orden alfabético
        res.json(productos);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener productos' });
    }
});

app.post('/api/productos', async (req, res) => {
    try {
        const ultimoProducto = await Producto.findOne().sort({ id: -1 });
        const nuevoId = ultimoProducto ? ultimoProducto.id + 1 : 1;
        const nuevoProducto = new Producto({ id: nuevoId, ...req.body });
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
        if (actualizado) res.json({ mensaje: "Producto actualizado" });
        else res.status(404).json({ mensaje: "Producto no encontrado" });
    } catch (error) { res.status(500).json({ error: 'Error actualizando' }); }
});

app.delete('/api/productos/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        await Producto.findOneAndDelete({ id: id });
        res.json({ mensaje: "Producto eliminado" });
    } catch (error) { res.status(500).json({ error: 'Error eliminando' }); }
});

// --- RUTAS DE VENTAS (POS Y WEB) ---

app.post('/api/nueva-venta', async (req, res) => {
    const { cliente, carrito, tipo, pagoRealizado, metodoPago, referenciaPago } = req.body; 
    let totalTransaccion = 0;
    
    try {
        // 1. Validar Stock
        for (let item of carrito) {
            const prod = await Producto.findOne({ id: item.id });
            if (!prod) return res.status(400).json({ mensaje: `Producto no encontrado: ${item.nombre}` });
            if (prod.stock < item.cantidad) return res.status(400).json({ mensaje: `Stock insuficiente: ${item.nombre}` });
            
            prod.stock -= item.cantidad;
            await prod.save();
            
            if (tipo !== 'donacion') {
                totalTransaccion += (prod.precio * item.cantidad);
            }
        }

        // 2. Calcular Deuda y Estado
        let deuda = 0;
        let estado = 'Pagado';

        if (tipo === 'donacion') {
            deuda = 0; estado = 'Donación';
        } else {
            if (metodoPago === 'Nequi Web') {
                deuda = 0;
                estado = 'Pagado (Nequi)';
            } else {
                if (pagoRealizado < totalTransaccion) {
                    deuda = totalTransaccion - pagoRealizado;
                    estado = pagoRealizado == 0 ? 'Debe' : 'Parcial';
                }
            }
        }

        // 3. Crear Venta
        const nuevaVenta = new Venta({
            id: Date.now(),
            fecha: new Date().toLocaleString(),
            cliente: cliente || (tipo === 'donacion' ? "Beneficiario" : "Cliente Web"),
            tipo: tipo,
            metodoPago: metodoPago || 'Efectivo',
            referenciaPago: referenciaPago || '',
            items: carrito,
            total: totalTransaccion,
            pagado: tipo === 'donacion' ? 0 : Number(pagoRealizado),
            deuda: Number(deuda),
            estado: estado
        });

        await nuevaVenta.save();
        res.json({ mensaje: "Venta registrada exitosamente" });

    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: "Error procesando la venta" });
    }
});

// --- RUTAS DE GESTIÓN (HISTORIAL Y ABONOS) ---

app.get('/api/ventas', async (req, res) => {
    try {
        const ventas = await Venta.find().sort({ id: -1 });
        res.json(ventas);
    } catch (error) { res.status(500).json({ error: 'Error obteniendo ventas' }); }
});

app.post('/api/abonar', async (req, res) => {
    const { idVenta, montoAbono } = req.body;
    try {
        const venta = await Venta.findOne({ id: idVenta });
        if (!venta) return res.status(404).json({ mensaje: "Venta no encontrada" });

        if (montoAbono > venta.deuda) return res.status(400).json({ mensaje: "El abono supera la deuda" });

        venta.pagado = Number(venta.pagado) + Number(montoAbono);
        venta.deuda = Number(venta.deuda) - Number(montoAbono);
        venta.estado = venta.deuda <= 0 ? 'Pagado' : 'Parcial';

        await venta.save();
        res.json({ mensaje: "Abono registrado" });
    } catch (error) { res.status(500).json({ mensaje: "Error al abonar" }); }
});

app.put('/api/ventas/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    const { cliente, total, pagado, items } = req.body;
    try {
        const ventaAnterior = await Venta.findOne({ id: id });
        if (!ventaAnterior) return res.status(404).json({ mensaje: "Venta no encontrada" });

        // Devolver stock viejo
        if (ventaAnterior.items) {
            for (let item of ventaAnterior.items) {
                const prod = await Producto.findOne({ id: item.id });
                if (prod) { prod.stock += Number(item.cantidad); await prod.save(); }
            }
        }
        // Restar stock nuevo
        if (items) {
            for (let item of items) {
                const prod = await Producto.findOne({ id: item.id });
                if (prod) { prod.stock -= Number(item.cantidad); await prod.save(); }
            }
        }

        const nuevoTotal = Number(total);
        const nuevoPagado = Number(pagado);
        const nuevaDeuda = nuevoTotal - nuevoPagado;
        
        ventaAnterior.cliente = cliente;
        ventaAnterior.items = items;
        ventaAnterior.total = nuevoTotal;
        ventaAnterior.pagado = nuevoPagado;
        ventaAnterior.deuda = nuevaDeuda > 0 ? nuevaDeuda : 0;
        ventaAnterior.estado = (ventaAnterior.tipo==='donacion')?'Donación':(nuevaDeuda<=0?'Pagado':(nuevoPagado==0?'Debe':'Parcial'));

        await ventaAnterior.save();
        res.json({ mensaje: "Venta corregida" });
    } catch (error) { res.status(500).json({ mensaje: "Error editando" }); }
});

app.delete('/api/ventas/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const venta = await Venta.findOne({ id: id });
        if (venta) {
            if(venta.items) {
                for (let item of venta.items) {
                    const prod = await Producto.findOne({ id: item.id });
                    if(prod) { prod.stock += Number(item.cantidad); await prod.save(); }
                }
            }
            await Venta.deleteOne({ id: id });
            res.json({ mensaje: "Venta eliminada y stock restaurado" });
        } else { res.status(404).json({ mensaje: "No encontrada" }); }
    } catch (error) { res.status(500).json({ mensaje: "Error eliminando" }); }
});

app.listen(puerto, () => {
    console.log(`✅ Servidor La Bodeguita de Mara listo en puerto ${puerto}`);
});