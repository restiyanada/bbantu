export async function createOrder(orderData: any) {
  try {
    const response = await fetch('/api/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderData)
    });

    if (response.status === 429) {
      const data = await response.json();
      throw new Error(data.error || 'Too many orders. Please wait.');
    }
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Order creation failed.');
    }
    return await response.json();
  } catch (error) {
    console.error('Order creation error:', error);
    throw error;
  }
}
