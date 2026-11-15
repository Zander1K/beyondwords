// The landing page: the first thing anyone sees. Black and blue, built the way ALX Studio's site
// is (inset rounded hero with a pixel dot texture, two-tone headlines, ringed dark cards, a dark
// call-to-action shell). It has ONE call to action, "Test this App", which asks for a username
// (any one, no password) and then opens the app. Copy lives in content.ts.
import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { AFTER_SIGN_IN, useAccess } from "@/access";
import { APP_NAME } from "@/config";

import { AccessDialog } from "./AccessDialog";
import { Button } from "./Button";
import {
  CTA_LABEL,
  FINAL,
  FOOTER,
  HERO,
  HERO_TITLE,
  IDEA,
  POWERED_BY,
  STEPS,
  TEAM,
} from "./content";
import { DotField } from "./DotField";
import { HeroVideo } from "./HeroVideo";
import styles from "./Landing.module.css";
import { PartnerLogo } from "./logos";
import { Reveal } from "./Reveal";

/** A route to go back to after signing in, if it is one of ours (never another site). */
function safeDestination(from: unknown): string | null {
  return typeof from === "string" && from.startsWith("/") && !from.startsWith("//") ? from : null;
}

function Logo() {
  return (
    <span className={styles.logo}>
      <span className={styles.mark} aria-hidden="true" />
      {APP_NAME}
    </span>
  );
}

/** A section heading: ruled eyebrow, then a two-tone title (the accent in blue), then the lede. */
function Heading({
  eyebrow,
  title,
  accent,
  lede,
}: {
  eyebrow?: string;
  title: string;
  accent: string;
  lede?: ReactNode;
}) {
  const lead = title.slice(0, title.length - accent.length);
  return (
    <div className={styles.heading}>
      {eyebrow && (
        <Reveal>
          <p className={styles.eyebrow}>{eyebrow}</p>
        </Reveal>
      )}
      <Reveal delay={60}>
        <h2 className={styles.h2}>
          {lead}
          <span className={styles.accent}>{accent}</span>
        </h2>
      </Reveal>
      {lede && (
        <Reveal delay={120}>
          <p className={styles.lede}>{lede}</p>
        </Reveal>
      )}
    </div>
  );
}

/** A name's initials for its avatar: "Alexander Dare" -> "AD". (Matthew and Michael Oladimeji
 * are both "MO"; each name is written next to its tile.) */
const initials = (name: string) =>
  name
    .split(" ")
    .map((word) => word[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

export function Landing() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAccess((s) => s.user);
  const state = location.state as { needAccess?: boolean; from?: unknown } | null;
  const destination = safeDestination(state?.from) ?? AFTER_SIGN_IN;

  // Opened straight away when someone was sent here from a page that needs access.
  const [open, setOpen] = useState(Boolean(state?.needAccess) && !user);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Already signed in this tab: straight to the app. Otherwise ask for access.
  const start = () => (user ? navigate(destination) : setOpen(true));

  let word = 0;
  return (
    <div className={styles.page}>
      <header className={styles.nav} data-scrolled={scrolled}>
        <div className={`${styles.container} ${styles.navInner}`}>
          <a href="#top" className={styles.logoLink} aria-label={`${APP_NAME}, top of page`}>
            <Logo />
          </a>
          <Button label={CTA_LABEL} size="md" onClick={start} />
        </div>
      </header>

      <main id="top">
        <section className={styles.shell} aria-label="Introduction">
          <div className={styles.hero}>
            <HeroVideo />
            <DotField seed={3} />
            <div className={`${styles.container} ${styles.heroGrid}`}>
              <div className={styles.heroCopy}>
                <div
                  className={`${styles.enter} ${styles.pillWrap}`}
                  style={{ ["--delay" as string]: "60ms" } as CSSProperties}
                >
                  <span className={styles.pill}>
                    <span className={styles.dot} />
                    {HERO.pill}
                  </span>
                </div>

                <h1 className={styles.title}>
                  {HERO_TITLE.map((part) => (
                    <span
                      key={part.text}
                      className={`${styles.titlePart} ${part.accent ? styles.accent : ""}`}
                    >
                      {part.text.split(" ").map((w) => (
                        <span key={`${part.text}-${w}`}>
                          <span
                            className={`${styles.enter} ${styles.word}`}
                            style={
                              { ["--delay" as string]: `${140 + word++ * 55}ms` } as CSSProperties
                            }
                          >
                            {w}
                          </span>{" "}
                        </span>
                      ))}
                    </span>
                  ))}
                </h1>

                <p
                  className={`${styles.enter} ${styles.heroText}`}
                  style={{ ["--delay" as string]: "560ms" } as CSSProperties}
                >
                  {HERO.description}
                </p>

                <div
                  className={`${styles.enter} ${styles.actions}`}
                  style={{ ["--delay" as string]: "660ms" } as CSSProperties}
                >
                  <Button label={CTA_LABEL} onClick={start} />
                  <p className={styles.note}>{HERO.note}</p>
                </div>

                <div
                  className={`${styles.enter} ${styles.poweredBy}`}
                  style={{ ["--delay" as string]: "760ms" } as CSSProperties}
                >
                  <span className={styles.poweredLabel}>Powered by</span>
                  <ul className={styles.poweredList}>
                    {POWERED_BY.partners.map((p) => (
                      <li key={p.id}>
                        <PartnerLogo id={p.id} className={styles.poweredLogo} />
                        {p.name}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.section} aria-label="The idea">
          <div className={styles.container}>
            <Heading
              eyebrow={IDEA.eyebrow}
              title={IDEA.title}
              accent={IDEA.accent}
              lede={IDEA.description}
            />
          </div>
        </section>

        <section className={`${styles.section} ${styles.tight}`} aria-label="How it works">
          <div className={styles.container}>
            <ol className={styles.steps}>
              {STEPS.map((step, i) => (
                <li key={step.title}>
                  <Reveal delay={i * 70} className={styles.step}>
                    <span className={styles.num}>{String(i + 1).padStart(2, "0")}</span>
                    <h3 className={styles.stepTitle}>{step.title}</h3>
                    <p className={styles.stepText}>{step.text}</p>
                  </Reveal>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={styles.section} aria-label="Powered by">
          <div className={styles.container}>
            <Heading
              title={POWERED_BY.title}
              accent={POWERED_BY.accent}
              lede={POWERED_BY.description}
            />
            <ul className={styles.cards}>
              {POWERED_BY.partners.map((p, i) => (
                <li key={p.name}>
                  <Reveal delay={i * 70} className={styles.cardWrap}>
                    <article className={styles.card}>
                      <span className={styles.logoTile}>
                        <PartnerLogo id={p.id} className={styles.partnerLogo} />
                      </span>
                      <p className={styles.role}>{p.role}</p>
                      <h3 className={styles.partner}>{p.name}</h3>
                      <p className={styles.cardText}>{p.text}</p>
                    </article>
                  </Reveal>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className={`${styles.section} ${styles.tight}`} aria-label="The team">
          <div className={styles.container}>
            <Heading eyebrow={TEAM.eyebrow} title={TEAM.title} accent={TEAM.accent} />
            <ul className={styles.people}>
              {TEAM.people.map((name, i) => (
                <li key={name}>
                  <Reveal delay={i * 70}>
                    <div className={styles.person}>
                      <span className={styles.avatar} aria-hidden="true">
                        {initials(name)}
                      </span>
                      <span className={styles.personName}>{name}</span>
                    </div>
                  </Reveal>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className={styles.shell} aria-label="Try it">
          <Reveal>
            <div className={styles.cta}>
              <DotField seed={5} />
              <h2 className={styles.ctaTitle}>
                {FINAL.title.slice(0, FINAL.title.length - FINAL.accent.length)}
                <span className={styles.ctaAccent}>{FINAL.accent}</span>
              </h2>
              <p className={styles.ctaText}>{FINAL.description}</p>
              <div className={styles.ctaButton}>
                <Button label={CTA_LABEL} onClick={start} />
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerTop}>
            <Logo />
            <div className={styles.footerLines}>
              <p>{FOOTER.poweredBy}</p>
              <p>{FOOTER.developedBy}</p>
            </div>
          </div>
          <div className={styles.legalRule}>
            <p className={styles.legal}>{FOOTER.legal}</p>
          </div>
        </div>
      </footer>

      <AccessDialog
        open={open}
        onClose={() => setOpen(false)}
        onSuccess={() => {
          setOpen(false);
          navigate(destination);
        }}
      />
    </div>
  );
}
