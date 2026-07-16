-- Restore trusted server reads removed while public table privileges were sealed.

grant select on table public.ticket_types to service_role;
grant select on table public.audit_log to service_role;
