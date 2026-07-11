import type { Metadata } from "next";
import { CompanyExplorer } from "./components/CompanyExplorer";

export const metadata: Metadata = {
  description:
    "指定公司與目標日期，拆開命盤象徵、同組態歷史、公司事件與資料界線，不替你下買賣結論。",
};

export default function Home() {
  return <CompanyExplorer />;
}
