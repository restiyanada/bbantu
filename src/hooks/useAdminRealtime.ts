import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type Notification = {
  id: string;
  type: 'new_order' | 'payment_uploaded';
  message: string;
  orderId: string;
  timestamp: Date;
};

export function useAdminRealtime() {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    const orderChannel = supabase
      .channel('admin-orders')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, (payload) => {
        const newOrder = payload.new as any;
        setNotifications(prev => [{
          id: crypto.randomUUID(),
          type: 'new_order',
          message: `📦 New order #${newOrder.order_number || newOrder.id.slice(0, 8)}`,
          orderId: newOrder.id,
          timestamp: new Date()
        }, ...prev]);
      })
      .subscribe();

    const paymentChannel = supabase
      .channel('admin-payments')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'payment_proofs' }, (payload) => {
        const newProof = payload.new as any;
        setNotifications(prev => [{
          id: crypto.randomUUID(),
          type: 'payment_uploaded',
          message: `💳 Payment uploaded for order #${newProof.order_id.slice(0, 8)}`,
          orderId: newProof.order_id,
          timestamp: new Date()
        }, ...prev]);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(orderChannel);
      supabase.removeChannel(paymentChannel);
    };
  }, []);

  const clearAll = () => setNotifications([]);
  const dismiss = (id: string) => setNotifications(prev => prev.filter(n => n.id !== id));

  return { notifications, clearAll, dismiss };
}
