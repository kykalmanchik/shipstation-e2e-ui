// The shapes this page reads. ShipStation's objects are wide and change; only the fields the page uses are named,
// everything else is kept and shown as JSON.

export interface Address {
  name?: string; company_name?: string | null; phone?: string | null; email?: string | null;
  address_line1?: string; address_line2?: string | null; address_line3?: string | null;
  city_locality?: string; state_province?: string; postal_code?: string; country_code?: string;
  address_residential_indicator?: string;
}

export interface Shipment {
  shipment_id: string;
  shipment_number?: string | null;
  external_shipment_id?: string | null;
  shipment_status?: string;
  hold_until_date?: string | null;
  store_id?: string | number | null;
  warehouse_id?: string | null;
  carrier_id?: string | null;
  service_code?: string | null;
  sales_order_ids?: string[] | null;
  created_at?: string;
  modified_at?: string;
  ship_date?: string | null;
  ship_to?: Address;
  ship_from?: Address | null;
  packages?: Array<{ package_code?: string; weight?: { value: number; unit: string }; dimensions?: { length: number; width: number; height: number; unit: string } }>;
  items?: Array<{ item_id?: string; sku?: string; name?: string; quantity?: number }>;
  tags?: Array<{ name: string; color?: string | null } | string>;
  internal_notes?: string | null;
  [key: string]: unknown;
}

export interface Label {
  label_id: string;
  shipment_id?: string;
  status?: "processing" | "completed" | "error" | "voided" | string;
  voided?: boolean;
  voided_at?: string | null;
  tracking_number?: string | null;
  tracking_status?: string | null;
  carrier_code?: string;
  carrier_id?: string;
  service_code?: string | null;
  created_at?: string | null;
  external_shipment_id?: string | null;
  shipment_cost?: { amount: number; currency: string } | null;
  label_download?: { pdf?: string; png?: string; zpl?: string; href?: string } | null;
  refund_details?: unknown;
  [key: string]: unknown;
}

export interface ShipmentRecord {
  shipment: Shipment;
  labels: Label[];
  fulfillments: Array<Record<string, unknown>>;
  fulfillmentsUnavailable: string | null;
}

export interface QuerySpec { name: string; type?: "date-time" | "integer"; enum?: string[] }
export type FieldSpec = { type?: "date" | "array"; enum?: string[] };

export interface Operation {
  id: string;
  scope: "shipment" | "label" | "account";
  group: string;
  kind: "read" | "write" | "spend" | "danger";
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  title: string;
  params?: Record<string, "se_id" | "segment">;
  query?: QuerySpec[];
  /** `true`: a body edited as JSON; an object: its fields. */
  body?: true | Record<string, FieldSpec>;
  notes?: string[];
}

/** Which ShipStation account the server talks to (shipstation-e2e-ui/.env). Never the key. */
export interface Account {
  environment: "sandbox" | "production";
  writes: boolean;
  limit: number;
  keySource: string | null;
}

export interface Meta {
  operations: Operation[];
  shipmentListQuery: QuerySpec[];
  statuses: string[];
  account: Account;
  /** Whether the server asks for the access code (ACCESS_CODE). */
  access: { required: boolean };
}

export interface ShipmentPage { shipments: Shipment[]; page?: number; pages?: number; total?: number; searched?: string }

export interface OpInput { params: Record<string, string>; query: Record<string, string>; body?: unknown }
export interface OpResult { operation: string; method: string; path: string; query: Record<string, string>; data: unknown }
