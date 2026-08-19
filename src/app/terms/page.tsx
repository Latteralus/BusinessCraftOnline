import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service — Business Craft Online",
  description: "Terms of Service for Business Craft Online.",
};

export default function TermsPage() {
  return (
    <div className="terms-page">
      <style>{`
        .terms-page {
          max-width: 820px;
          margin: 0 auto;
          padding: 48px 24px 80px;
          color: var(--text-primary);
        }
        .terms-page a {
          color: var(--accent-green, #34d399);
        }
        .terms-header {
          margin-bottom: 32px;
          padding-bottom: 20px;
          border-bottom: 1px solid var(--border-subtle);
        }
        .terms-title {
          font-size: 1.75rem;
          font-weight: 700;
          margin: 0 0 8px;
          color: var(--text-primary);
        }
        .terms-effective-date {
          font-size: 0.85rem;
          color: var(--text-secondary);
          margin: 0;
        }
        .terms-notice {
          background: var(--bg-card, rgba(255,255,255,0.03));
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md, 10px);
          padding: 14px 16px;
          font-size: 0.8rem;
          color: var(--text-secondary);
          margin-bottom: 32px;
          line-height: 1.6;
        }
        .terms-section {
          margin-bottom: 28px;
        }
        .terms-section h2 {
          font-size: 1.05rem;
          font-weight: 700;
          margin: 0 0 10px;
          color: var(--text-primary);
        }
        .terms-section p,
        .terms-section li {
          font-size: 0.9rem;
          line-height: 1.7;
          color: var(--text-secondary);
        }
        .terms-section p {
          margin: 0 0 12px;
        }
        .terms-section ul {
          margin: 0 0 12px;
          padding-left: 22px;
        }
        .terms-section li {
          margin-bottom: 6px;
        }
        .terms-flag {
          display: inline-block;
          font-size: 0.7rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--accent-amber, #fbbf24);
          background: var(--accent-amber-dim, rgba(251,191,36,0.12));
          border: 1px solid rgba(251,191,36,0.25);
          border-radius: 6px;
          padding: 2px 8px;
          margin-top: 4px;
        }
        .terms-footer {
          margin-top: 40px;
          padding-top: 20px;
          border-top: 1px solid var(--border-subtle);
          font-size: 0.8rem;
          color: var(--text-secondary);
        }
        .terms-back-link {
          display: inline-block;
          margin-bottom: 24px;
          font-size: 0.85rem;
        }
      `}</style>

      <Link href="/" className="terms-back-link">
        ← Back to Business Craft Online
      </Link>

      <header className="terms-header">
        <h1 className="terms-title">Terms of Service</h1>
        <p className="terms-effective-date">Effective Date: August 19, 2026</p>
      </header>

      <section className="terms-section">
        <h2>1. Acceptance of Terms</h2>
        <p>
          By accessing Business Craft Online, creating an account, or otherwise using the service in
          any way, you agree to be bound by these Terms of Service (the &ldquo;Terms&rdquo;). If you
          do not agree to these Terms, do not access or use the service. We may update these Terms
          from time to time as described in Section 25.
        </p>
      </section>

      <section className="terms-section">
        <h2>2. Description of the Service</h2>
        <p>
          Business Craft Online is an online persistent browser-based business and economic
          simulation game (the &ldquo;Service&rdquo;). Players create a character, operate
          businesses, manage employees and inventory, participate in a simulated market economy, and
          interact with other players and non-player characters (NPCs) within a continuously running
          simulation. Gameplay systems, mechanics, balancing, in-game content, features, and overall
          availability of the Service may change, be added, be removed, or be rebalanced over time as
          described in Sections 15 and 19.
        </p>
      </section>

      <section className="terms-section">
        <h2>3. Limited License to Use the Game</h2>
        <p>
          Subject to your compliance with these Terms, Business Craft Online grants you a limited,
          personal, non-exclusive, non-transferable, and revocable right to access and play the
          Service for your own personal, non-commercial entertainment. This is permission to{" "}
          <strong>use</strong> the game — it is not a sale or transfer of ownership of the Service,
          the underlying software, or any game content. No rights are granted to you except those
          expressly stated in these Terms.
        </p>
      </section>

      <section className="terms-section">
        <h2>4. Intellectual Property</h2>
        <p>
          Business Craft Online&rsquo;s protected source code, software architecture, original written
          material, graphics, artwork, user-interface content, game content, game data, branding, and
          other original copyrighted materials remain the property of their respective owner. No
          ownership rights in the Service or its content are transferred to you by using the Service,
          and all rights not expressly granted in these Terms are reserved.
        </p>
        <p>
          Nothing in this Section, and nothing in these Terms generally, claims copyright protection
          over abstract game ideas, mathematical formulas, methods, algorithms, general economic or
          simulation concepts, or other elements that are not protectable subject matter under
          applicable copyright law.
        </p>
      </section>

      <section className="terms-section">
        <h2>5. Prohibited Copying / Distribution</h2>
        <p>Except as expressly authorized in writing by us, you may not:</p>
        <ul>
          <li>copy or reproduce the Service or its source code;</li>
          <li>distribute, publish, sublicense, sell, rent, or otherwise commercially exploit the Service;</li>
          <li>create or distribute unauthorized derivative works based upon the Service;</li>
          <li>redistribute the Service&rsquo;s source code; or</li>
          <li>host or distribute unauthorized copies of the Service.</li>
        </ul>
      </section>

      <section className="terms-section">
        <h2>6. Clone / Competing Services</h2>
        <p>
          You may not use Business Craft Online&rsquo;s protected code, assets, text, branding, or
          other copyrighted expression to create or operate an unauthorized clone, mirror, copy, or
          competing hosted version of the Service. This restriction applies to our specific protected
          expression, not to the general, unprotectable concept of a business simulation game or
          persistent browser-based game (PBBG) as a genre.
        </p>
      </section>

      <section className="terms-section">
        <h2>7. Reverse Engineering</h2>
        <p>
          Except to the extent such restriction is prohibited by applicable law, you may not reverse
          engineer, decompile, disassemble, circumvent technical protection measures, attempt to
          discover the Service&rsquo;s non-public source code, or bypass access controls protecting
          the Service.
        </p>
      </section>

      <section className="terms-section">
        <h2>8. Automation / Bots</h2>
        <p>
          Unless expressly authorized by us in writing, you may not use bots, macros, scripts,
          automated gameplay tools, unattended gameplay automation, automated account operation, or
          automated market manipulation, or otherwise take automated actions intended to gain an
          unfair gameplay advantage. This section is not intended to, and does not, prohibit the use
          of ordinary browser features or assistive/accessibility technologies (such as screen
          readers, browser zoom, or keyboard-navigation tools) needed to access and use the Service.
        </p>
      </section>

      <section className="terms-section">
        <h2>9. Scraping / Data Extraction</h2>
        <p>
          Unless expressly authorized by us, you may not use automated means to extract, scrape,
          harvest, mirror, or bulk-collect game data, account information, market data, or other Site
          content. This restriction does not apply to ordinary interactive use of the Service through
          a standard web browser, to well-behaved search engine indexing where otherwise appropriate,
          or to activity we expressly authorize.
        </p>
      </section>

      <section className="terms-section">
        <h2>10. Cheating / Exploits</h2>
        <p>You may not:</p>
        <ul>
          <li>knowingly exploit bugs, glitches, or unintended behavior in the Service;</li>
          <li>duplicate currency, items, or other game state through an exploit;</li>
          <li>manipulate game systems outside of their intended mechanics;</li>
          <li>tamper with client requests or bypass gameplay restrictions;</li>
          <li>exploit race conditions or otherwise abuse the Service&rsquo;s APIs or RPC endpoints; or</li>
          <li>make unauthorized modifications to account, game, or database state.</li>
        </ul>
        <p>
          If you discover a vulnerability or exploit, please report it to us rather than using or
          disclosing it. Do not exploit a vulnerability you discover, even to &ldquo;test&rdquo; it.
        </p>
      </section>

      <section className="terms-section">
        <h2>11. Security / Unauthorized Access</h2>
        <p>You may not attempt to:</p>
        <ul>
          <li>access another player&rsquo;s account without authorization;</li>
          <li>access administrative systems or internal APIs without authorization;</li>
          <li>bypass authentication, authorization, or row-level security protections;</li>
          <li>obtain service-role credentials, API keys, or other secrets you are not authorized to hold;</li>
          <li>probe, scan, or attack our infrastructure; or</li>
          <li>interfere with the availability of the Service or perform destructive or unauthorized security testing against it.</li>
        </ul>
        <p>
          This section does not prohibit legitimate security research that we have expressly
          authorized in advance.
        </p>
      </section>

      <section className="terms-section">
        <h2>12. Account Responsibilities</h2>
        <p>
          You are responsible for maintaining the confidentiality and security of your account
          credentials and for all activity that occurs through your account. You may not impersonate
          another person or access another player&rsquo;s account without authorization. Notify us
          promptly if you believe your account has been compromised.
        </p>
      </section>

      <section className="terms-section">
        <h2>13. Account Sales / Transfers</h2>
        <p>
          Unless we explicitly introduce and authorize a system permitting it, you may not sell,
          purchase, rent, transfer, or otherwise trade accounts or account credentials.
        </p>
      </section>

      <section className="terms-section">
        <h2>14. Game Items, Currency, Property, and Progress</h2>
        <p>
          Business Craft Online is an online persistent game. In-game currency, businesses,
          inventory, property, statistics, employees, accounts, progression, rankings, and similar
          game-state elements exist solely as part of the Service and do not convey any ownership
          interest in Business Craft Online&rsquo;s underlying software, source code, or
          infrastructure. Game balance, values, mechanics, items, and systems may change as the game
          evolves, as described in Section 15.
        </p>
        <p>
          As of the Effective Date of these Terms, Business Craft Online does not offer real-money
          purchases. If that changes in the future, this Section will be updated to describe the
          applicable terms.
        </p>
      </section>

      <section className="terms-section">
        <h2>15. Game Balance / Updates</h2>
        <p>We reserve the right to:</p>
        <ul>
          <li>rebalance game systems and formulas;</li>
          <li>adjust prices and other economic parameters;</li>
          <li>add or remove features;</li>
          <li>modify game content;</li>
          <li>correct exploits;</li>
          <li>perform data migrations; and</li>
          <li>reset or correct game state obtained through illegitimate means.</li>
        </ul>
      </section>

      <section className="terms-section">
        <h2>16. Player Conduct</h2>
        <p>
          You agree not to abuse the Service, including by engaging in harassment, threats, fraud,
          impersonation, malicious disruption, spam, or other attempts to interfere with other
          players&rsquo; use of the Service. This includes conduct within any in-game chat or mail
          features.
        </p>
      </section>

      <section className="terms-section">
        <h2>17. User-Generated Content</h2>
        <p>
          Certain features of the Service (such as in-game chat messages and player-to-player mail)
          allow you to submit content, including messages you send to other players. By submitting
          such content, you grant us a limited, non-exclusive license to store, transmit, display, and
          moderate that content solely as necessary to operate and provide the Service (for example,
          delivering your message to its recipient, or reviewing content in response to a report). We
          do not claim broader ownership of content you submit beyond what is necessary to operate the
          Service.
        </p>
      </section>

      <section className="terms-section">
        <h2>18. Moderation / Enforcement</h2>
        <p>
          We may investigate suspected violations of these Terms and take proportionate action as we
          reasonably determine necessary to protect the Service, other players, the game economy, our
          infrastructure, or the integrity of the Service. Such action may include, without
          limitation, warnings, reversal of exploited transactions or state, temporary suspension, or
          permanent account termination.
        </p>
      </section>

      <section className="terms-section">
        <h2>19. Availability</h2>
        <p>
          We do not guarantee uninterrupted or error-free access to the Service. Maintenance, outages,
          bugs, updates, data migrations, infrastructure failures, or other events may temporarily
          affect the Service&rsquo;s availability.
        </p>
      </section>

      <section className="terms-section">
        <h2>20. Termination</h2>
        <p>
          We may suspend or terminate your access to the Service, including for violation of these
          Terms, at our reasonable discretion. Provisions of these Terms that by their nature should
          survive termination — including, without limitation, the intellectual property protections
          in Sections 4 through 7, and the disclaimers and limitations in Sections 21 and 22 — will
          continue to apply after your access ends.
        </p>
      </section>

      <section className="terms-section">
        <h2>21. Disclaimer of Warranties</h2>
        <p>
          To the maximum extent permitted by applicable law, the Service is provided &ldquo;as
          is&rdquo; and &ldquo;as available,&rdquo; without warranties of any kind, whether express,
          implied, or statutory, including implied warranties of merchantability, fitness for a
          particular purpose, and non-infringement. We do not warrant that the Service will be
          uninterrupted, secure, or error-free.
        </p>
      </section>

      <section className="terms-section">
        <h2>
          22. Limitation of Liability
        </h2>
        <p>
          To the maximum extent permitted by applicable law, Business Craft Online will not be liable
          for any indirect, incidental, special, consequential, or punitive damages, or any loss of
          data, profits, or goodwill, arising out of or related to your use of the Service, even if
          advised of the possibility of such damages.
        </p>
      </section>

      <section className="terms-section">
        <h2>
          23. Indemnification
        </h2>
        <p>
          You agree to indemnify and hold Business Craft Online harmless from claims, damages, and
          expenses (including reasonable attorneys&rsquo; fees) arising out of your misuse of the
          Service, your violation of these Terms, or your infringement of another party&rsquo;s rights
          through your own conduct.
        </p>
      </section>

      <section className="terms-section">
        <h2>25. Changes to Terms</h2>
        <p>
          We may update these Terms from time to time. If we make material changes, we will make
          reasonable efforts to communicate the change (for example, by updating the Effective Date
          above or by an in-game notice). Continued use of the Service after a change takes effect
          constitutes acceptance of the revised Terms.
        </p>
      </section>

      <section className="terms-section">
        <h2>26. Contact</h2>
        <p>
          Questions regarding these Terms may be submitted through the official Business Craft Online
          support/contact method provided within the Service.
        </p>
      </section>

      <section className="terms-section">
        <h2>27. Entire Agreement / Severability</h2>
        <p>
          These Terms constitute the entire agreement between you and Business Craft Online regarding
          your use of the Service and supersede any prior agreements on this subject. If any provision
          of these Terms is found unenforceable, that provision will be enforced to the maximum extent
          permitted and the remaining provisions will remain in full force and effect.
        </p>
      </section>

      <div className="terms-footer">Copyright © 2026 Business Craft Online. All Rights Reserved.</div>
    </div>
  );
}
