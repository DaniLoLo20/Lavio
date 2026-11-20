export const INCOME_CATS = [
  { value: 'SERVICE_SALE', label: 'Venta de servicios' },
  { value: 'PRODUCT_SALE', label: 'Venta de productos' },
  { value: 'EXTRA_INCOME', label: 'Ingreso extraordinario' },
  { value: 'ADJUSTMENT', label: 'Ajuste' },
];

export const EXPENSE_CATS = [
  { value: 'PURCHASE', label: 'Compras' },
  { value: 'STATIONERY', label: 'Papelería' },
  { value: 'OPERATING', label: 'Gastos operativos' },
  { value: 'PAYROLL', label: 'Nómina' },
  { value: 'MAINTENANCE', label: 'Mantenimiento' },
  { value: 'OTHER', label: 'Otros' },
];

export const CAT_LABEL: Record<string, string> = Object.fromEntries([...INCOME_CATS, ...EXPENSE_CATS].map((c) => [c.value, c.label]));
export const SOURCE_LABEL: Record<string, string> = { ORDERS: 'Cobros de órdenes', ...CAT_LABEL };
