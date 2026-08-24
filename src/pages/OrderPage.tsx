import { useParams } from "react-router-dom";

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">Order {id}</h1>
      <p className="text-gray-500 mt-2">
        Guest order status/timeline from PRD §16 will live here.
      </p>
    </main>
  );
}
