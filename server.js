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

// --- CONEXIÓN BD ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Conectado a MongoDB Atlas'))
    .catch(err => console.error('❌ Error BD:', err));

// --- MODELOS ---
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
    tipo: String,
    metodoPago: String,
    referenciaPago: String,
    items: Array,
    total: Number,
    pagado: Number,
    deuda: Number,
    estado: String
});
const Venta = mongoose.model('Venta', ventaSchema);

// --- RUTAS ---
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === "mara123") res.json({ exito: true });
    else res.status(401).json({ exito: false });
});

app.get('/api/productos', async (req, res) => {
    try {
        const productos = await Producto.find().sort({ nombre: 1 });
        res.json(productos);
    } catch (error) { res.status(500).json({ error: 'Error productos' }); }
});

app.post('/api/productos', async (req, res) => {
    try {
        const ultimo = await Producto.findOne().sort({ id: -1 });
        const nuevoId = ultimo ? ultimo.id + 1 : 1;
        const nuevo = new Producto({ id: nuevoId, ...req.body });
        await nuevo.save();
        res.json({ mensaje: "Creado" });
    } catch (error) { res.status(500).json({ error: 'Error creando' }); }
});

app.put('/api/productos/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        await Producto.findOneAndUpdate({ id: id }, req.body);
        res.json({ mensaje: "Actualizado" });
    } catch (error) { res.status(500).json({ error: 'Error actualizando' }); }
});

app.delete('/api/productos/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        await Producto.findOneAndDelete({ id: id });
        res.json({ mensaje: "Eliminado" });
    } catch (error) { res.status(500).json({ error: 'Error eliminando' }); }
});

// --- VENTAS ---
app.get('/api/ventas', async (req, res) => {
    try {
        const ventas = await Venta.find().sort({ id: -1 });
        res.json(ventas);
    } catch (error) { res.status(500).json({ error: 'Error ventas' }); }
});

app.post('/api/nueva-venta', async (req, res) => {
    const { cliente, carrito, tipo, pagoRealizado, metodoPago, referenciaPago } = req.body;
    let total = 0;
    try {
        for (let item of carrito) {
            const prod = await Producto.findOne({ id: item.id });
            if (!prod || prod.stock < item.cantidad) return res.status(400).json({ mensaje: "Stock insuficiente" });
            prod.stock -= item.cantidad;
            await prod.save();
            if (tipo !== 'donacion') total += (prod.precio * item.cantidad);
        }

        let deuda = 0, estado = 'Pagado';
        if (tipo === 'donacion') {
            deuda = 0; estado = 'Donación';
        } else {
            if (metodoPago === 'Nequi Web') {
                deuda = 0; estado = 'Pagado (Nequi)';
            } else {
                if (pagoRealizado < total) {
                    deuda = total - pagoRealizado;
                    estado = pagoRealizado == 0 ? 'Debe' : 'Parcial';
                }
            }
        }

        const venta = new Venta({
            id: Date.now(),
            fecha: new Date().toLocaleString(),
            cliente: cliente || "Cliente Web",
            tipo, metodoPago, referenciaPago,
            items: carrito, total,
            pagado: tipo === 'donacion' ? 0 : Number(pagoRealizado),
            deuda, estado
        });
        await venta.save();
        res.json({ mensaje: "Exito" });
    } catch (error) { res.status(500).json({ mensaje: "Error servidor" }); }
});

// --- EDITAR VENTA (ACTUALIZADO) ---
app.put('/api/ventas/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    const { cliente, total, pagado, items, referenciaPago } = req.body; // AHORA RECIBIMOS REFERENCIA
    try {
        const venta = await Venta.findOne({ id: id });
        if (!venta) return res.status(404).json({ mensaje: "No existe" });

        // Ajuste de stock
        if (venta.items) {
            for (let i of venta.items) {
                const p = await Producto.findOne({ id: i.id });
                if (p) { p.stock += Number(i.cantidad); await p.save(); }
            }
        }
        if (items) {
            for (let i of items) {
                const p = await Producto.findOne({ id: i.id });
                if (p) { p.stock -= Number(i.cantidad); await p.save(); }
            }
        }

        // Recalculos
        const nTotal = Number(total);
        const nPagado = Number(pagado);
        const nDeuda = nTotal - nPagado;
        
        venta.cliente = cliente;
        venta.items = items;
        venta.total = nTotal;
        venta.pagado = nPagado;
        venta.deuda = nDeuda > 0 ? nDeuda : 0;
        venta.referenciaPago = referenciaPago || venta.referenciaPago; // ACTUALIZAMOS REFERENCIA
        
        // Logica de estado
        if(venta.tipo === 'donacion') venta.estado = 'Donación';
        else if (venta.metodoPago.includes('Nequi')) venta.estado = 'Pagado (Nequi)';
        else venta.estado = nDeuda <= 0 ? 'Pagado' : (nPagado == 0 ? 'Debe' : 'Parcial');

        await venta.save();
        res.json({ mensaje: "Editado" });
    } catch (error) { res.status(500).json({ mensaje: "Error editando" }); }
});

app.post('/api/abonar', async (req, res) => {
    const { idVenta, montoAbono } = req.body;
    try {
        const v = await Venta.findOne({ id: idVenta });
        if (!v) return res.status(404).json({ mensaje: "No existe" });
        if (montoAbono > v.deuda) return res.status(400).json({ mensaje: "Monto excesivo" });
        v.pagado += Number(montoAbono);
        v.deuda -= Number(montoAbono);
        v.estado = v.deuda <= 0 ? 'Pagado' : 'Parcial';
        await v.save();
        res.json({ mensaje: "Abonado" });
    } catch (error) { res.status(500).json({ mensaje: "Error" }); }
});

app.delete('/api/ventas/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const v = await Venta.findOne({ id: id });
        if (v && v.items) {
            for (let i of v.items) {
                const p = await Producto.findOne({ id: i.id });
                if (p) { p.stock += Number(i.cantidad); await p.save(); }
            }
            await Venta.deleteOne({ id: id });
            res.json({ mensaje: "Eliminado" });
        } else res.status(404).json({ mensaje: "No encontrado" });
    } catch (error) { res.status(500).json({ mensaje: "Error" }); }
});

app.listen(puerto, () => console.log(`🔥 Servidor listo en ${puerto}`));