import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";

export function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        <p className="page-eyebrow">{eyebrow}</p>
        <h1 className="page-title">{title}</h1>
        <p className="page-subtitle">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ icon = "file", title, description, compact = false }: { icon?: IconName; title: string; description: string; compact?: boolean }) {
  return (
    <div className={`empty-state${compact ? " compact" : ""}`}>
      <span className="empty-icon"><Icon name={icon} size={21} /></span>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

export function DataTable({ columns, icon, title, description }: { columns: string[]; icon: IconName; title: string; description: string }) {
  return (
    <section className="panel">
      <div className="panel-header"><div><h2>Registros</h2><p>Listado y seguimiento operativo</p></div><span className="status-pill"><i className="status-dot" />Sin datos</span></div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
          <tbody><tr><td className="empty-cell" colSpan={columns.length}><EmptyState icon={icon} title={title} description={description} /></td></tr></tbody>
        </table>
      </div>
    </section>
  );
}

export function SearchField({ placeholder }: { placeholder: string }) {
  return <label className="search-field"><Icon name="search" size={16} /><input aria-label={placeholder} placeholder={placeholder} type="search" /></label>;
}

export function ModuleNotice({ children }: { children: ReactNode }) {
  return <div className="callout"><Icon name="info" size={16} /><span>{children}</span></div>;
}
