import type { Metadata } from "next";
import { CompanyExplorer } from "./components/CompanyExplorer";

export const metadata: Metadata = {
  description:
    "用公司成立日或首日交易建立命盤基準，將主要行運對齊臺股歷史收盤價。",
};

export default function Home() {
  return <CompanyExplorer />;
}
