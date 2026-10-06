import { type ProcessJob, isScheduled, orderKeyOf } from "../types/processJob";

export interface OrderGroup {
  id: string;
  name: string;
  customer: string;
  badge: boolean;
  count: number;
}

// OrderScreen縦軸のグループ決定：スケジュール済みオーダーの一覧
export function orderGroups(jobs: ProcessJob[]): OrderGroup[] {
  const map = new Map<string, OrderGroup>();
  jobs.filter(isScheduled).forEach((j) => {
    const key = orderKeyOf(j);
    if (!map.has(key)) {
      map.set(key, { id: key, name: j.orderNumber ? j.orderNumber : j.orderNo, customer: j.customer, badge: !j.orderNumber, count: 0 });
    }
    map.get(key)!.count++;
  });
  return Array.from(map.values()).sort((a, b) => (a.id < b.id ? -1 : 1));
}
