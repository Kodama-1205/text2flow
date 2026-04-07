import { ReactNode } from "react";
import styles from "./AppShell.module.css";

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.logoMark}>
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <rect width="32" height="32" rx="9" fill="url(#logoGrad)" />
              <path d="M9 10h6M9 16h14M9 22h10" stroke="white" strokeWidth="2" strokeLinecap="round" />
              <path d="M19 8l5 8-5 8" stroke="rgba(255,255,255,0.65)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <defs>
                <linearGradient id="logoGrad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#7c3aed" />
                  <stop offset="1" stopColor="#a78bfa" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <div>
            <div className={styles.appTitle}>Text2Flow</div>
            <div className={styles.appSub}>文章から業務フロー図を自動生成</div>
          </div>
        </div>
      </header>

      <main className={styles.main}>{children}</main>

      <footer className={styles.footer}>
        © 2026 Text2Flow
      </footer>
    </div>
  );
}
