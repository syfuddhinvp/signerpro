export type DocumentStatus =
  | "draft"
  | "prepared"
  | "sent"
  | "viewed"
  | "partially_completed"
  | "completed"
  | "declined"
  | "expired"
  | "voided";

export type RecipientStatus = "waiting" | "sent" | "viewed" | "completed" | "declined" | "expired";
export type WorkflowType = "parallel" | "sequential";
export type FieldType =
  | "signature"
  | "full_name"
  | "date"
  | "text"
  | "checkbox"
  | "dropdown"
  | "currency"
  | "number"
  | "radio";

export interface User {
  id: string;
  organization_id: string;
  name: string;
  email: string;
  role: "admin" | "sender";
}

export interface AuthResponse {
  access_token: string;
  token_type: "bearer";
  user: User;
}

export interface DocumentRecord {
  id: string;
  organization_id: string;
  sender_id: string;
  title: string;
  status: DocumentStatus;
  workflow_type: WorkflowType;
  is_template: boolean;
  original_file_path: string | null;
  final_file_path: string | null;
  original_sha256: string | null;
  field_config_sha256: string | null;
  final_sha256: string | null;
  page_count: number;
  sent_at: string | null;
  completed_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  recipients_total: number;
  recipients_completed: number;
}

export interface RecipientRecord {
  id: string;
  document_id: string;
  name: string;
  email: string;
  role_name: string | null;
  signing_order: number;
  status: RecipientStatus;
  viewed_at: string | null;
  completed_at: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  otp_enabled?: boolean;
  phone_number?: string | null;
  otp_verified?: boolean;
  consent_accepted?: boolean;
  consent_accepted_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface FieldRecord {
  id: string;
  document_id: string;
  recipient_id: string;
  type: FieldType;
  label: string;
  required: boolean;
  page_number: number;
  x: string;
  y: string;
  width: string;
  height: string;
  placeholder: string | null;
  default_value: string | null;
  value: string | null;
  options: unknown;
  is_locked: boolean;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  event_type: string;
  event_message: string;
  recipient_id: string | null;
  user_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  log_metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface SigningSession {
  document: {
    title: string;
    status: DocumentStatus;
    workflow_type: WorkflowType;
    page_count: number;
  };
  recipient: {
    name: string;
    email: string;
    role_name: string | null;
    status: RecipientStatus;
  };
  current_recipient_id: string;
  fields: FieldRecord[];
  read_only: boolean;
  expires_at: string;
  pdf_url: string;
  required_total: number;
  required_completed: number;
  otp_required?: boolean;
  consent_required?: boolean;
}

export interface SaaSMetrics {
  total_organizations: number;
  total_users: number;
  total_documents: number;
  active_subscriptions: number;
  tier_counts: Record<string, number>;
}

export interface SaaSOrganization {
  id: string;
  name: string;
  subscription_tier: string;
  subscription_status: string;
  subscription_expires_at: string | null;
  created_at: string;
  users_count: number;
  documents_count: number;
}

export interface SaaSUser {
  id: string;
  name: string;
  email: string;
  role: string;
  created_at: string;
  organization_id: string;
  organization_name: string;
}
