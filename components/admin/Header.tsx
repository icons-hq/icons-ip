export function Header({
  admin,
  title,
}: {
  admin: { email: string | null; role: string };
  title: string;
}) {
  const initial = (admin.email ?? 'staff').charAt(0).toUpperCase();

  return (
    <header className="admin-header">
      <h1 className="admin-title">{title}</h1>
      <div className="row" style={{ gap: 12 }}>
        <div className="col hide-mob" style={{ alignItems: 'flex-end', gap: 3 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{admin.email ?? 'staff'}</span>
          <span className="tag" style={{ color: 'var(--violet-2)' }}>{admin.role}</span>
        </div>
        <span className="admin-avatar">{initial}</span>
      </div>
    </header>
  );
}
