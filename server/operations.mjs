// Every ShipStation API v2 operation this tool can run — the allowlist the server enforces and the menu the page draws.
// Read from the ShipStation API v2 2.0.0 OpenAPI (docs.shipstation.com, 2026-10-22); `notes` quote or paraphrase the
// spec's own words, and say where this sandbox was measured to differ. Nothing outside this list reaches ShipStation.
//
//   scope   shipment — acts on one shipment (the expanded row); label — on one of its labels; account — on the account
//   kind    read (no change) · write (changes ShipStation) · spend (buys a label: free in the sandbox) · danger (hard to undo)
//   params  path parameters and the rule each must pass (`PARAM_RULES`)

const DOWNLOAD = { name: "label_download_type", enum: ["url", "inline"] };
const LABEL_OPTIONS = {
  validate_address: { enum: ["no_validation", "validate_only", "validate_and_clean"] },
  label_layout: { enum: ["4x6", "letter"] },
  label_format: { enum: ["pdf", "png", "zpl"] },
  label_download_type: { enum: ["url", "inline"] },
  display_scheme: { enum: ["label", "paperless", "label_and_paperless"] },
};
const DOCUMENT_TYPES = ["commercial_invoice", "certificate_of_origin", "usmca_commercial_invoice_certification_of_origin", "usmca_certification_of_origin",
  "pro_forma_invoice", "other", "authorization_form", "export_accompanying_document", "export_license", "import_permit", "one_time_nafta",
  "power_of_attorney", "packing_list", "sed_document", "shippers_letter_of_instruction", "declaration", "section_232_customs_affidavit"];

/** The documented `shipment_status` values, and the two this sandbox answers that the spec does not list (measured 2026-10-21/22). */
export const SHIPMENT_STATUSES = ["pending", "processing", "label_purchased", "cancelled", "on_hold", "pending_fulfillment"];

/** `GET /v2/shipments` (list_shipments): every query parameter of the spec. */
export const SHIPMENT_LIST_QUERY = [
  { name: "shipment_status", enum: SHIPMENT_STATUSES },
  { name: "shipment_number" }, { name: "external_shipment_id" }, { name: "ship_to_name" }, { name: "item_keyword" },
  { name: "store_id" }, { name: "sales_order_id" }, { name: "batch_id" }, { name: "tag" },
  { name: "created_at_start", type: "date-time" }, { name: "created_at_end", type: "date-time" },
  { name: "modified_at_start", type: "date-time" }, { name: "modified_at_end", type: "date-time" },
  { name: "payment_date_start", type: "date-time" }, { name: "payment_date_end", type: "date-time" },
  { name: "sort_by", enum: ["created_at", "modified_at"] }, { name: "sort_dir", enum: ["desc", "asc"] },
  { name: "page", type: "integer" }, { name: "page_size", type: "integer" },
];

export const PARAM_RULES = {
  se_id: /^se(-[a-z0-9]+)+$/,
  // Free text that ends up in one path segment: no separators, no control characters.
  segment: /^[^/?#\\\u0000-\u001f]{1,200}$/,
};

export const OPERATIONS = [
  // ---- shipment: read ----
  { id: "shipment.get", scope: "shipment", group: "Read", kind: "read", method: "GET", path: "/shipments/{shipment_id}", title: "Get shipment", params: { shipment_id: "se_id" } },
  { id: "shipment.byExternal", scope: "shipment", group: "Read", kind: "read", method: "GET", path: "/shipments/external_shipment_id/{external_shipment_id}", title: "Get shipment by external id", params: { external_shipment_id: "segment" } },
  { id: "shipment.labels", scope: "shipment", group: "Read", kind: "read", method: "GET", path: "/labels", title: "List its labels", query: [{ name: "shipment_id" }, { name: "label_status", enum: ["processing", "completed", "error", "voided"] }, { name: "page_size", type: "integer" }] },
  { id: "shipment.fulfillments", scope: "shipment", group: "Read", kind: "read", method: "GET", path: "/fulfillments", title: "List its fulfillments", query: [{ name: "shipment_id" }, { name: "page_size", type: "integer" }] },
  { id: "shipment.savedRates", scope: "shipment", group: "Read", kind: "read", method: "GET", path: "/shipments/{shipment_id}/rates", title: "Get its saved rates", params: { shipment_id: "se_id" }, query: [{ name: "created_at_start", type: "date-time" }] },
  { id: "shipment.documentStatuses", scope: "shipment", group: "Read", kind: "read", method: "GET", path: "/shipments/{shipment_id}/labels", title: "Document statuses", params: { shipment_id: "se_id" },
    notes: ["The spec calls this \"List shipments and their document statuses\": it returns shipments with their documents, not labels."] },

  // ---- shipment: the desk ----
  { id: "rates.calculate", scope: "shipment", group: "Labels", kind: "read", method: "POST", path: "/rates", title: "Get rates", body: true,
    notes: ["Either shipment_id or shipment, never both. rate_options.carrier_ids is required; rate_type is check, shipment or quick."] },
  { id: "label.buyForShipment", scope: "shipment", group: "Labels", kind: "spend", method: "POST", path: "/labels/shipment/{shipment_id}", title: "Buy label for this shipment", params: { shipment_id: "se_id" }, body: LABEL_OPTIONS,
    notes: ["Uses the carrier and service already on the shipment.", "Purchasing a label spends money — a free test label in the sandbox."] },
  { id: "label.buyFromRate", scope: "shipment", group: "Labels", kind: "spend", method: "POST", path: "/labels/rates/{rate_id}", title: "Buy label from a rate", params: { rate_id: "se_id" },
    body: { ...LABEL_OPTIONS, custom_field1: {}, custom_field2: {}, custom_field3: {}, external_shipment_id: {} },
    notes: ["Take the rate_id from Get rates.", "Purchasing a label spends money — a free test label in the sandbox."] },
  { id: "shipment.hold", scope: "shipment", group: "Hold", kind: "write", method: "PUT", path: "/shipments/{shipment_id}/hold", title: "Hold until a date", params: { shipment_id: "se_id" }, body: { hold_until_date: { type: "date" } },
    notes: ["hold_until_date is date-only and must be later than today; holding a held shipment replaces its date.", "A cancelled shipment or one with a purchased label cannot be held (400)."] },
  { id: "shipment.restore", scope: "shipment", group: "Hold", kind: "write", method: "PUT", path: "/shipments/{shipment_id}/restore", title: "Release hold (restore)", params: { shipment_id: "se_id" },
    notes: ["Only a shipment on hold can be restored."] },
  { id: "shipment.update", scope: "shipment", group: "Edit", kind: "write", method: "PUT", path: "/shipments/{shipment_id}", title: "Update shipment", params: { shipment_id: "se_id" }, body: true,
    notes: ["Before a label is purchased. Needs warehouse_id or ship_from.", "Measured in this sandbox: not partial — send the whole shipment (warehouse_id and packages included); a labelled shipment silently ignores it."] },
  { id: "shipment.notes", scope: "shipment", group: "Edit", kind: "write", method: "POST", path: "/shipments/{shipment_id}/internal_notes", title: "Internal notes", params: { shipment_id: "se_id" },
    body: { note: {}, mode: { enum: ["append", "overwrite"] } }, notes: ["append adds to the notes; overwrite replaces them (an empty note clears)."] },
  { id: "shipment.tagAdd", scope: "shipment", group: "Tags", kind: "write", method: "POST", path: "/shipments/{shipment_id}/tags/{tag_name}", title: "Add tag", params: { shipment_id: "se_id", tag_name: "segment" } },
  { id: "shipment.tagRemove", scope: "shipment", group: "Tags", kind: "write", method: "DELETE", path: "/shipments/{shipment_id}/tags/{tag_name}", title: "Remove tag", params: { shipment_id: "se_id", tag_name: "segment" } },
  { id: "shipment.tags", scope: "shipment", group: "Tags", kind: "read", method: "GET", path: "/shipments/{shipment_id}/tags", title: "List its tags", params: { shipment_id: "se_id" } },
  { id: "fulfillment.create", scope: "shipment", group: "Ship", kind: "write", method: "POST", path: "/fulfillments", title: "Mark shipped without a label", body: true,
    notes: ["fulfillment_shipped_v2: shipped with tracking but no ShipStation label.", "Measured 2026-10-27/28: this sandbox accepts it, lists the fulfillment (without a tracking number and with the shipment pending_fulfillment for a few seconds, then label_purchased) and sends fulfillment_shipped_v2 after about 20 s. The 2026-10-22 note that it never appears is out of date.", "Integrations that follow the label ignore a fulfillment beside a bought label: void the label first (the Desk's Shipped move does)."] },
  { id: "shipment.assignUser", scope: "shipment", group: "Edit", kind: "write", method: "POST", path: "/shipments/user", title: "Assign a user", body: { shipment_ids: { type: "array" }, user_id: {} } },
  { id: "shipment.split", scope: "shipment", group: "Split & merge", kind: "danger", method: "POST", path: "/shipments/{shipment_id}/split", title: "Split shipment", params: { shipment_id: "se_id" }, body: true,
    notes: ["Status pending, awaiting_payment or on_hold, linked to a sales order (sales_order_ids); at least one item stays.", "Each entry of shipments creates one new shipment with the items listed."] },
  { id: "shipment.merge", scope: "shipment", group: "Split & merge", kind: "danger", method: "POST", path: "/shipments/{shipment_id}/merge", title: "Merge shipments into this one", params: { shipment_id: "se_id" }, body: { shipment_ids: { type: "array" } },
    notes: ["Every shipment pending, awaiting_payment or on_hold and linked to a sales order. The merged shipments are DELETED."] },
  { id: "shipment.documents", scope: "shipment", group: "Documents", kind: "read", method: "GET", path: "/shipments/{shipment_id}/documents", title: "List documents", params: { shipment_id: "se_id" } },
  { id: "shipment.documentRegister", scope: "shipment", group: "Documents", kind: "write", method: "POST", path: "/shipments/{shipment_id}/documents", title: "Register a document", params: { shipment_id: "se_id" },
    body: { type: { enum: DOCUMENT_TYPES }, format: { enum: ["PDF", "PNG"] }, file_name: {} }, notes: ["Returns an upload target (a pre-signed S3 POST); this tool does not upload the file."] },
  { id: "shipment.documentDelete", scope: "shipment", group: "Documents", kind: "write", method: "DELETE", path: "/shipments/{shipment_id}/documents/{document_id}", title: "Delete a document", params: { shipment_id: "se_id", document_id: "segment" },
    notes: ["A document already sent cannot be deleted (409)."] },
  { id: "shipment.cancel", scope: "shipment", group: "Cancel", kind: "danger", method: "PUT", path: "/shipments/{shipment_id}/cancel", title: "Cancel shipment", params: { shipment_id: "se_id" },
    notes: ["Any label on it must be voided first.", "A cancelled shipment stays cancelled."] },

  // ---- label ----
  { id: "label.get", scope: "label", group: "Label", kind: "read", method: "GET", path: "/labels/{label_id}", title: "Get label", params: { label_id: "se_id" }, query: [DOWNLOAD] },
  { id: "label.track", scope: "label", group: "Label", kind: "read", method: "GET", path: "/labels/{label_id}/track", title: "Tracking", params: { label_id: "se_id" },
    notes: ["Measured 2026-10-22: a label with no tracking number answers 400 \"Label does not have a tracking number\"."] },
  { id: "label.void", scope: "label", group: "Label", kind: "danger", method: "PUT", path: "/labels/{label_id}/void", title: "Void label", params: { label_id: "se_id" },
    notes: ["A refused void is a 200 with approved: false — read the answer.", "The shipment goes back to pending."] },
  { id: "label.return", scope: "label", group: "Label", kind: "spend", method: "POST", path: "/labels/{label_id}/return", title: "Create return label", params: { label_id: "se_id" },
    body: { charge_event: { enum: ["carrier_default", "on_creation", "on_carrier_acceptance"] }, ...LABEL_OPTIONS, label_image_id: {} },
    notes: ["Swaps the ship to and ship from of the original label."] },
  { id: "label.cancelRefund", scope: "label", group: "Label", kind: "write", method: "POST", path: "/labels/{label_id}/cancel_refund", title: "Cancel refund request", params: { label_id: "se_id" } },
  { id: "label.byExternal", scope: "label", group: "Label", kind: "read", method: "GET", path: "/labels/external_shipment_id/{external_shipment_id}", title: "Label by external shipment id", params: { external_shipment_id: "segment" }, query: [DOWNLOAD],
    notes: ["Returns only the earliest label with that id."] },
  { id: "label.documents", scope: "label", group: "Documents", kind: "read", method: "GET", path: "/labels/{label_id}/documents", title: "List documents", params: { label_id: "se_id" } },
  { id: "label.documentRegister", scope: "label", group: "Documents", kind: "write", method: "POST", path: "/labels/{label_id}/documents", title: "Register a document", params: { label_id: "se_id" },
    body: { type: { enum: DOCUMENT_TYPES }, format: { enum: ["PDF", "PNG"] }, file_name: {} }, notes: ["Returns an upload target; this tool does not upload the file."] },
  { id: "label.documentsSend", scope: "label", group: "Documents", kind: "write", method: "POST", path: "/labels/{label_id}/documents/send", title: "Send documents to the carrier", params: { label_id: "se_id" } },
  { id: "label.documentDelete", scope: "label", group: "Documents", kind: "write", method: "DELETE", path: "/labels/{label_id}/documents/{document_id}", title: "Delete a document", params: { label_id: "se_id", document_id: "segment" } },
  { id: "tracking.start", scope: "label", group: "Tracking", kind: "write", method: "POST", path: "/tracking/start", title: "Start tracking", query: [{ name: "carrier_code" }, { name: "tracking_number" }, { name: "carrier_id" }],
    notes: ["Listed for the Advanced and Enterprise API plans only."] },
  { id: "tracking.stop", scope: "label", group: "Tracking", kind: "write", method: "POST", path: "/tracking/stop", title: "Stop tracking", query: [{ name: "carrier_code" }, { name: "tracking_number" }] },

  // ---- account ----
  { id: "labels.list", scope: "account", group: "Labels", kind: "read", method: "GET", path: "/labels", title: "List labels",
    query: [{ name: "label_status", enum: ["processing", "completed", "error", "voided"] }, { name: "service_code" }, { name: "carrier_id" }, { name: "tracking_number" }, { name: "batch_id" },
      { name: "rate_id" }, { name: "shipment_id" }, { name: "external_shipment_id" }, { name: "warehouse_id" }, { name: "created_at_start", type: "date-time" }, { name: "created_at_end", type: "date-time" },
      { name: "refund_status" }, { name: "page", type: "integer" }, { name: "page_size", type: "integer" }, { name: "sort_dir", enum: ["desc", "asc"] }, { name: "sort_by", enum: ["created_at", "modified_at", "voided_at"] }] },
  { id: "fulfillments.list", scope: "account", group: "Fulfillments", kind: "read", method: "GET", path: "/fulfillments", title: "List fulfillments",
    query: [{ name: "ship_to_name" }, { name: "ship_to_country_code" }, { name: "shipment_number" }, { name: "shipment_id" }, { name: "fulfillment_id" }, { name: "batch_id" }, { name: "order_source_id" },
      { name: "fulfillment_provider_code" }, { name: "tracking_number" }, { name: "ship_date_start", type: "date-time" }, { name: "ship_date_end", type: "date-time" },
      { name: "create_date_start", type: "date-time" }, { name: "create_date_end", type: "date-time" }, { name: "page", type: "integer" }, { name: "page_size", type: "integer" },
      { name: "sort_dir", enum: ["desc", "asc"] }, { name: "sort_by", enum: ["created_at", "modified_at", "shipped_at"] }] },
  { id: "shipments.holdMany", scope: "account", group: "Shipments", kind: "write", method: "POST", path: "/shipments/hold", title: "Hold many shipments", body: { shipment_ids: { type: "array" }, hold_until_date: { type: "date" } },
    notes: ["Up to 500 ids. 207 when some were held: the rest are in errors."] },
  { id: "shipments.restoreMany", scope: "account", group: "Shipments", kind: "write", method: "POST", path: "/shipments/restore", title: "Restore many shipments", body: { shipment_ids: { type: "array" } },
    notes: ["Up to 500 ids. 207 when some were restored."] },
  { id: "tags.list", scope: "account", group: "Tags", kind: "read", method: "GET", path: "/tags", title: "List tags" },
  { id: "tags.create", scope: "account", group: "Tags", kind: "write", method: "POST", path: "/tags", title: "Create a tag", body: { name: {}, color: {} } },
  { id: "tracking.get", scope: "account", group: "Tracking", kind: "read", method: "GET", path: "/tracking", title: "Tracking by number", query: [{ name: "carrier_code" }, { name: "tracking_number" }, { name: "carrier_id" }],
    notes: ["Listed for the Advanced and Enterprise API plans only."] },
  { id: "rates.get", scope: "account", group: "Rates", kind: "read", method: "GET", path: "/rates/{rate_id}", title: "Get rate by id", params: { rate_id: "se_id" } },
  { id: "carriers.list", scope: "account", group: "Carriers", kind: "read", method: "GET", path: "/carriers", title: "List carriers" },
  { id: "carrier.services", scope: "account", group: "Carriers", kind: "read", method: "GET", path: "/carriers/{carrier_id}/services", title: "Carrier services", params: { carrier_id: "se_id" } },
  { id: "carrier.packages", scope: "account", group: "Carriers", kind: "read", method: "GET", path: "/carriers/{carrier_id}/packages", title: "Carrier package types", params: { carrier_id: "se_id" } },
  { id: "carrier.options", scope: "account", group: "Carriers", kind: "read", method: "GET", path: "/carriers/{carrier_id}/options", title: "Carrier options", params: { carrier_id: "se_id" } },
];

export const OPERATIONS_BY_ID = new Map(OPERATIONS.map((op) => [op.id, op]));
