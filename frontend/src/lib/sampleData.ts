import type { ConsensusInput } from "../types";

export interface Preset {
  label: string;
  hint: string;
  input: ConsensusInput;
}

export const PRESETS: Preset[] = [
  {
    label: "Invoice — over cap",
    hint: "Amount breaches the critical cap → reject",
    input: {
      source_material: "Invoice #A-90. Total due: 1,200.00 USD. Vendor: Acme Ltd. Terms: Net 30.",
      extraction_schema: "total_amount:number(2); currency:enum(USD|EUR|GBP); vendor_name:string",
      rule_set:
        "r_amount_cap: total_amount <= 1000 [critical]; r_currency_allowed: currency in {USD,EUR} [high]",
      constraints: "",
      policy: "",
    },
  },
  {
    label: "Invoice — clean",
    hint: "All rules pass → approve",
    input: {
      source_material: "Invoice #B-14. Total due: 640.00 USD. Vendor: Northwind Inc.",
      extraction_schema: "total_amount:number(2); currency:enum(USD|EUR|GBP); vendor_name:string",
      rule_set:
        "r_amount_cap: total_amount <= 1000 [critical]; r_currency_allowed: currency in {USD,EUR} [high]",
      constraints: "",
      policy: "",
    },
  },
  {
    label: "KYC — missing field",
    hint: "Required field absent → flag / review",
    input: {
      source_material: "Applicant: Dana Rivera. Country: PT. Risk band: medium.",
      extraction_schema: "applicant_name:string; country:enum(PT|ES|FR); tax_id:string",
      rule_set:
        "r_tax_present: tax_id present [high]; r_country_allowed: country in {PT,ES,FR} [medium]",
      constraints: "",
      policy: "",
    },
  },
];
