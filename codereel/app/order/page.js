import { Suspense } from "react";
import OrderFlow from "@/components/OrderFlow";

export const metadata = { title: "Order your video – Codereel" };

export default function OrderPage() {
  // useSearchParams (inside OrderFlow) needs a Suspense boundary for static builds
  return (
    <Suspense fallback={null}>
      <OrderFlow />
    </Suspense>
  );
}
