const TIPOS_SALIDA = ['salida_guia', 'salida_epp', 'baja_dano', 'transferencia_salida'];
const TIPOS_ENTRADA = ['entrada_compra', 'transferencia_entrada'];
const TIPOS_VALIDOS = [...TIPOS_SALIDA, ...TIPOS_ENTRADA, 'ajuste'];

// Aplica un movimiento de stock. Debe llamarse con un "client" (no el pool) dentro
// de una transacción ya abierta con BEGIN, para que el bloqueo de fila (FOR UPDATE)
// sea efectivo si dos personas registran movimientos del mismo producto a la vez.
async function aplicarMovimiento(client, { empresaId, almacenId, productoId, tipoMovimiento, cantidad, costoUnitario, guiaId, tecnico, personalId, numeroFactura, nota, userId }) {
  if (!TIPOS_VALIDOS.includes(tipoMovimiento)) {
    throw new Error(`Tipo de movimiento inválido: ${tipoMovimiento}`);
  }
  if (tipoMovimiento === 'ajuste' && !nota) {
    throw new Error('Los ajustes de inventario requieren una nota explicando el motivo');
  }
  if (tipoMovimiento !== 'ajuste' && (!cantidad || cantidad <= 0)) {
    throw new Error('La cantidad debe ser mayor a 0');
  }

  const stockRes = await client.query(
    'SELECT cantidad FROM stock WHERE almacen_id = $1 AND producto_id = $2 FOR UPDATE',
    [almacenId, productoId]
  );
  const cantidadAnterior = stockRes.rows[0] ? Number(stockRes.rows[0].cantidad) : 0;

  let delta;
  if (tipoMovimiento === 'ajuste') {
    delta = Number(cantidad); // en ajuste, la cantidad ya viene como el delta con signo
  } else if (TIPOS_SALIDA.includes(tipoMovimiento)) {
    delta = -Math.abs(Number(cantidad));
    if (cantidadAnterior + delta < 0) {
      throw new Error(`Stock insuficiente: hay ${cantidadAnterior}, se intentó sacar ${Math.abs(cantidad)}`);
    }
  } else {
    delta = Math.abs(Number(cantidad));
  }

  const nuevaCantidad = cantidadAnterior + delta;

  if (stockRes.rows.length) {
    await client.query('UPDATE stock SET cantidad = $1 WHERE almacen_id = $2 AND producto_id = $3', [nuevaCantidad, almacenId, productoId]);
  } else {
    await client.query(
      'INSERT INTO stock (empresa_id, almacen_id, producto_id, cantidad) VALUES ($1,$2,$3,$4)',
      [empresaId, almacenId, productoId, nuevaCantidad]
    );
  }

  const movRes = await client.query(
    `INSERT INTO movimientos_almacen (empresa_id, almacen_id, producto_id, tipo_movimiento, cantidad, cantidad_anterior, costo_unitario, guia_id, tecnico, personal_id, numero_factura, nota, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [empresaId, almacenId, productoId, tipoMovimiento, delta, cantidadAnterior, costoUnitario || null, guiaId || null, tecnico || null, personalId || null, numeroFactura || null, nota || null, userId]
  );

  return { movimiento: movRes.rows[0], stockNuevo: nuevaCantidad };
}

module.exports = { aplicarMovimiento, TIPOS_SALIDA, TIPOS_ENTRADA, TIPOS_VALIDOS };
