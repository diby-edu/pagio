import { Config, User } from '../api';
import { t } from '../i18n';
import { TOOLS, desc, title } from '../tools';

export default function Home({ config, user, go }: { config: Config | null; user: User | null; go: (p: string) => void }) {
  const visible = TOOLS.filter((tool) => config?.tools[tool.id]?.enabled !== false)
    .filter((tool) => tool.id !== 'assistant' || config?.ai_enabled !== false)
    .filter((tool) => tool.id !== 'office_to_pdf' || config?.server_conversion !== false);
  return (
    <>
      <section className="hero">
        <h1>{t('hero')}</h1>
        <p className="lead">{t('hero_sub')}</p>
        {!user && <div className="row"><a className="btn primary" href="#/inscription">{t('signup')}</a><a className="btn" href="#/connexion">{t('signin')}</a></div>}
      </section>
      <section className="grid">
        {visible.map((tool) => {
          const flag = config?.tools[tool.id];
          return (
            <button key={tool.id} className="card tool" onClick={() => go(`/outil/${tool.id}`)}>
              <span className="ic" style={{ background: tool.color }} aria-hidden>{tool.icon}</span>
              <span className="body">
                <b>{t(title(tool.id))}</b>
                <span className="muted">{t(desc(tool.id))}</span>
                <span className="tags">
                  <span className={`tag ${tool.where}`}>{tool.where === 'local' ? t('local') : t('server')}</span>
                  {tool.where === 'server' && <span className="tag">{t('needs_account')}</span>}
                  {flag?.premium && <span className="tag premium">{t('premium')}</span>}
                </span>
              </span>
            </button>
          );
        })}
      </section>
      <p className="apk">📱 {t('apk')} <a href="/">{t('get_apk')} →</a></p>
    </>
  );
}
