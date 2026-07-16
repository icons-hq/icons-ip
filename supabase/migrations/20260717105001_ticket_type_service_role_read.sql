-- Restore trusted server reads removed when public ticket-type writes were sealed.

grant select on table public.ticket_types to service_role;
