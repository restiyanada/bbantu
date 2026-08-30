/// <reference lib="deno.ns" />
// ============================================================
// CONFIRM PAYMENT – Admin verifies payment, updates stock atomically
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
);

// ----- Admin permission check (using boolean columns) -----
async function requireAdmin(req: Request, requiredPermission: string) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) throw new Error('Unauthorized');
  const token = authHeader.replace('Bearer ', '');
  
  const { data: user, error } = await supabase.auth.getUser(token);
  if (error || !user) throw new Error('Invalid token');

  const { data: admin, error: adminErr } = await supabase
    .from('admin_users')
    .select('*')
    .eq('id', user.user.id)
    .single();

  if (adminErr || !admin) throw new Error('Not an admin');

  const permissionMap: Record<string, string> = {
    verify_payments: 'can_verify_payments',
    scan_pickup: 'can_scan_confirm_pickup',
  };
  const permColumn = permissionMap[requiredPermission];
  if (!permColumn || admin[permColumn] !== true) {
    throw new Error(`Insufficient permissions for ${requiredPermission}`);
  }
  return admin;
}

// ----- Stock decrement (calls SQL function with 3 parameters) -----
async function decrementStock(variantId: string, quantity: number, orderId: string): Promise<void> {
  const { error } = await supabase.rpc('decrement_stock', {
    p_variant_id: variantId,
    p_quantity: quantity,
    p_order_id: orderId
  });
  if (error) {
    throw new Error(`Stock decrement failed: ${error.message}`);
  }
}

// ----- Main handler -----
Deno.serve(async (req: Request) => {
  try {
    await requireAdmin(req, 'verify_payments');

    const { orderId, idempotencyKey } = await req.json();
    if (!orderId) throw new Error('Missing orderId');

    // Idempotency check
    if (idempotencyKey) {
      const { data: existing } = await supabase
        .from('orders')
        .select('id')
        .eq('idempotency_key', idempotencyKey)
        .single();
      if (existing) {
        return new Response(JSON.stringify({ 
          success: true, 
          message: 'Already processed', 
          orderId 
        }), { status: 200 });
      }
    }

    // Fetch order with its items
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select(`
        id,
        status,
        order_items (
          variant_id,
          quantity
        )
      `)
      .eq('id', orderId)
      .single();

    if (orderErr || !order) throw new Error('Order not found');
    if (order.status !== 'awaiting_payment') {
      throw new Error('Order already processed');
    }

    // Atomically decrement stock for each item
    for (const item of order.order_items) {
      await decrementStock(item.variant_id, item.quantity, orderId);
    }

    // Update order status
    const { error: updateErr } = await supabase
      .from('orders')
      .update({ 
        status: 'paid',
        idempotency_key: idempotencyKey || null
      })
      .eq('id', orderId)
      .eq('status', 'awaiting_payment');

    if (updateErr) throw updateErr;

    return new Response(JSON.stringify({ 
      success: true, 
      orderId,
      message: 'Payment confirmed and stock updated'
    }), { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('Confirm payment error:', error);
    const status = error.message?.includes('Unauthorized') ? 401 :
                   error.message?.includes('permissions') ? 403 : 500;
    return new Response(JSON.stringify({ 
      error: error.message || 'An internal error occurred' 
    }), { 
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});