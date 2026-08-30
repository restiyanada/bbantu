import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
);

async function checkRateLimit(ip: string, action: string, limit = 5, windowSeconds = 60) {
  const cutoff = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const { count, error } = await supabase
    .from('rate_limits')
    .select('id', { count: 'exact', head: true })
    .eq('ip', ip)
    .eq('action', action)
    .gte('created_at', cutoff);
  if (error) throw error;
  if (count && count >= limit) throw new Error('Too many requests. Please wait.');
}

async function recordRateLimit(ip: string, action: string) {
  await supabase.from('rate_limits').insert({ ip, action });
}

async function hashToken(rawToken: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(rawToken);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
    await checkRateLimit(ip, 'create_order', 5, 60);
    await recordRateLimit(ip, 'create_order');

    const { customer_id, items, shipping_address, payment_type, sales_mode, fulfilment_method } = await req.json();
    if (!items || !items.length) throw new Error('No items');

    const variantIds = items.map((i: any) => i.variant_id);
    const { data: variants, error: variantsErr } = await supabase
      .from('product_variants')
      .select('id, price')
      .in('id', variantIds);
    if (variantsErr || !variants) throw new Error('Failed to fetch product data');

    let subtotal = 0;
    const orderItems = items.map((item: any) => {
      const variant = variants.find(v => v.id === item.variant_id);
      if (!variant) throw new Error(`Variant ${item.variant_id} not found`);
      const subtotalItem = Number(variant.price) * item.quantity;
      subtotal += subtotalItem;
      return { variant_id: item.variant_id, quantity: item.quantity, price_at_time: variant.price };
    });

<<<<<<< HEAD
    const shippingCost = 0; // Compute or fetch from shipping API
    const rawToken = crypto.randomUUID();
    const tokenHash = await hashToken(rawToken);

    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({
        customer_id,
        sales_mode,
        payment_type,
        fulfilment_method: fulfilment_method || null,
        merchandise_subtotal: subtotal,
        shipping_cost: shippingCost,
        amount_paid: subtotal + shippingCost,
        status: 'awaiting_payment',
        access_token: rawToken,      // Temporary - will be phased out
        access_token_hash: tokenHash,
        access_token_encrypted: null,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (orderErr) throw orderErr;

    const orderItemsWithId = orderItems.map(item => ({ ...item, order_id: order.id }));
    const { error: itemsErr } = await supabase.from('order_items').insert(orderItemsWithId);
    if (itemsErr) throw itemsErr;

    return new Response(JSON.stringify({
      success: true,
      orderId: order.id,
      token: rawToken,
      trackingUrl: `${Deno.env.get('APP_URL')}/track?token=${rawToken}`
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
=======
    notifyAdmins({
      title: "New order placed",
      body: `Order ${formatOrderNumber(order.order.fulfilmentMethod, order.order.orderNumber, order.order.id)} — Rp ${order.order.merchandiseSubtotal}`,
>>>>>>> 589d41ee6b1d6a8f9cce4a47d79fa8ced0982b74
    });

  } catch (error) {
    console.error('Create order error:', error);
    const status = error.message.includes('Too many') ? 429 : 500;
    return new Response(JSON.stringify({ error: error.message || 'Internal error' }), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});
