import type { Metadata } from "next";
import CheckApp from "@/components/check/CheckApp";

export const metadata: Metadata = {
  title: "Check a draft · DCM MoM Insights",
  description: "Check a draft Board agenda or resolution against past Board decisions and approved limits.",
};

export default function CheckPage() {
  return <CheckApp />;
}
