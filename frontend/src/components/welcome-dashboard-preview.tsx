import {
  CalendarCheck,
  UsersRound,
  MailCheck,
  LayoutDashboard,
  Phone,
  ChartNoAxesColumnIncreasing,
  CircleCheck,
  Bell,
  Search,
} from "lucide-react";

/** Decorative example only: no queries, production statistics or interactive controls. */
export function WelcomeDashboardPreview() {
  return (
    <div className="welcome-product" aria-hidden="true" inert>
      <div className="welcome-preview">
        <aside className="welcome-preview-sidebar">
          <img src="/images/kent-business-college-logo.png" alt="" />
          <strong>Event Registrations Hub</strong>
          <small>Confirmation operations</small>
          {[LayoutDashboard, CalendarCheck, UsersRound, Phone, ChartNoAxesColumnIncreasing].map(
            (Icon, i) => (
              <div className={i === 0 ? "preview-nav-active" : ""} key={i}>
                <Icon />
                {["Dashboard", "Events", "People", "Call backs", "Reports"][i]}
              </div>
            ),
          )}
        </aside>
        <div className="welcome-preview-content">
          <div className="preview-toolbar">
            <span>
              <Search />
              Search events, people or notes...
            </span>
            <Bell />
            <b>M</b>
          </div>
          <h2>Dashboard</h2>
          <p>Confirmation and attendance performance across your event pipeline.</p>
          <div className="preview-kpis">
            {[CalendarCheck, UsersRound, CircleCheck].map((Icon, i) => (
              <div key={i}>
                <Icon />
                <section>
                  <small>{["Upcoming events", "Registrations", "Confirmed"][i]}</small>
                  <strong>{["3", "8", "0"][i]}</strong>
                  <p>{["Next 30 days", "8 not contacted yet", "0% of registrations"][i]}</p>
                </section>
                <span className="preview-bars">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            ))}
          </div>
          <div className="preview-chart">
            <small>Illustrative dashboard preview</small>
            <svg viewBox="0 0 680 260" fill="none">
              <path
                d="M0 40h680M0 100h680M0 160h680M0 220h680"
                stroke="#e7e1f7"
                strokeDasharray="3 4"
              />
              <path
                d="M0 230L85 190L160 200L230 155L305 170L385 120L465 130L540 65L620 75L680 30V260H0Z"
                fill="#ede7ff"
              />
              <path
                d="M0 230L85 190L160 200L230 155L305 170L385 120L465 130L540 65L620 75L680 30"
                stroke="#9872ff"
                strokeWidth="4"
              />
            </svg>
          </div>
        </div>
      </div>
      <div className="welcome-floating-stat">
        <UsersRound />
        <div>
          <strong>8</strong>
          <p>Registrations</p>
          <small>Illustrative preview</small>
        </div>
        <span>›</span>
      </div>
      <span className="welcome-floating-icon">
        <MailCheck />
      </span>
    </div>
  );
}
