import { ReactNode } from "react";
import styles from "./AppShell.module.css";

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.appTitle}>Text2Flow</div>
          <div className={styles.appSub}>文章から業務フロー図を自動生成</div>
        </div>
        {/* Purple Edition は不要なので削除 */}
      </header>

      <main className={styles.main}>{children}</main>

      <footer className={styles.footer}>
        © 2026 Text2Flow ・ Workflow ready
      </footer>
    </div>
  );
}
