import styles from "./AppShell.module.css";

export default function AppShell({
  title = "Text2Flow",
  subtitle = "文章から業務フロー図を自動生成",
  children,
}: {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.logo} aria-hidden />
          <div>
            <div className={styles.title}>{title}</div>
            <div className={styles.subtitle}>{subtitle}</div>
          </div>
        </div>

        <div className={styles.badge}>Purple Edition</div>
      </header>

      <main className={styles.main}>{children}</main>

      <footer className={styles.footer}>
        <span>© {new Date().getFullYear()} Text2Flow</span>
        <span className={styles.dot}>•</span>
        <span className={styles.muted}>Workflow ready</span>
      </footer>
    </div>
  );
}
