import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowDown,
  ArrowUpRight,
  Droplets,
  Globe2,
  Leaf,
  ShieldCheck,
  Sun,
  Thermometer,
  Waves,
} from 'lucide-react';
import { getPreferredLanguage, savePreferredLanguage, type Language } from '@services/language';
import { ThemeToggle } from '@components/ThemeToggle';
import { ScrollReveal } from '@components/ScrollReveal';

const copy = {
  ar: {
    navAbout: 'عن المنصة',
    navFeatures: 'المزايا',
    navHow: 'كيف تعمل',
    signIn: 'تسجيل الدخول',
    signUp: 'إنشاء حساب',
    badge: 'مراقبة زراعية أوضح، وقرارات أهدأ',
    title: 'افهم ما يحدث في بيتك الزراعي.',
    titleAccent: 'واتخذ قرارك بثقة.',
    intro: 'SENSOURA تجمع قراءات الحساسات وحالة النظام والتوصيات في لوحة واحدة، لتسهّل متابعة ظروف الزراعة والتخطيط للري.',
    createAccount: 'ابدأ بإنشاء حساب',
    explore: 'تعرّف على المنصة',
    signupNote: 'الحسابات الجديدة تبدأ بصلاحية مشاهدة فقط.',
    previewLabel: 'معاينة توضيحية',
    previewTitle: 'نظرة على لوحة المتابعة',
    previewImageCaption: 'بيئة زراعية متصلة بالبيانات',
    previewNote: 'هذه معاينة للواجهة، وليست بيانات حية.',
    sensorImageAlt: 'حساس زراعي ومسبار تربة بين أوراق نباتات في بيت زراعي',
    greenhouseImageAlt: 'ممر أخضر داخل بيت زراعي حديث',
    irrigationImageAlt: 'ري بالتنقيط لنباتات مزروعة داخل بيت زراعي',
    metricAir: 'حرارة الهواء',
    metricSoil: 'رطوبة التربة',
    metricLight: 'الإضاءة',
    waiting: 'تظهر القراءات عند اتصال الجهاز',
    whatTitle: 'كل ما تحتاجه لمتابعة أوضح',
    whatIntro: 'اجمع الإشارات المهمة في مكان واحد، مع فصل واضح بين قراءات البيت الزراعي والسياق المناخي الخارجي.',
    featureSensors: 'قراءات الحساسات',
    featureSensorsText: 'تابع حرارة الهواء والتربة، الرطوبة، والإضاءة عندما يرسل الجهاز قراءاته.',
    featureClimate: 'سياق مناخي خارجي',
    featureClimateText: 'اطّلع على تقديرات المناخ اليومية كمعلومة مساعدة، منفصلة عن قياسات البيت الزراعي.',
    featureActions: 'توصيات وتحكم',
    featureActionsText: 'راجع اقتراحات الري وحالة الأوامر. تنفيذ الأوامر يحتاج جهازًا وخادمًا مهيأين.',
    detailEyebrow: 'ما الذي تتابعه المنصة؟',
    detailTitle: 'إشارات متعددة، في صورة واحدة أوضح.',
    detailIntro: 'تجمع SENSOURA قراءات البيئة والتربة والري، وتوضح مصدر كل معلومة وحدودها بدل خلط التقديرات الخارجية بقياسات البيت الزراعي.',
    detailEnvironmentTitle: 'البيئة والهواء',
    detailEnvironmentText: 'عند اتصال الحساسات، يمكن متابعة حرارة الهواء، الرطوبة، الضوء، الضغط الجوي ومؤشر جودة الهواء إلى جانب حالة البيئة الزراعية.',
    detailSoilTitle: 'التربة والري',
    detailSoilText: 'تساعد حرارة التربة ورطوبتها على فهم احتياج النبات. وتعرض اللوحة طلب تشغيل المضخة منفصلًا عن حالة المرحّل التي يبلّغ عنها الجهاز.',
    detailDecisionTitle: 'رؤى قابلة للمراجعة',
    detailDecisionText: 'تساعد التقديرات والاقتراحات على قراءة الاتجاهات، لكنها ليست ضمانًا للنتيجة ولا تشغّل المضخة تلقائيًا. التحكم يحتاج صلاحية وموافقة الجهاز.',
    detailFootnote: 'لا تظهر القياسات الحقيقية إلا بعد إعداد الحساسات والخادم ومصدر البيانات؛ وتظل بيانات التطوير التجريبية معلّمة بوضوح.',
    stepsTitle: 'من القراءة إلى القرار',
    step1: 'اربط الجهاز',
    step1Text: 'جهّز ESP32 والحساسات والاتصال الآمن بالخادم.',
    step2: 'راقب المؤشرات',
    step2Text: 'تابع القراءات والتنبيهات وحالة الاتصال من لوحة واحدة.',
    step3: 'اتخذ الإجراء',
    step3Text: 'استخدم التوصيات، أو تحكم بصلاحية المشغّل عند اتصال العتاد.',
    aboutTitle: 'عن SENSOURA',
    aboutText: 'SENSOURA مشروع للزراعة الذكية يربط بيانات الحساسات بواجهة متابعة واضحة، ليساعد على فهم الظروف الزراعية واتخاذ قرارات مبنية على البيانات.',
    disclaimer: 'عند تشغيل وضع Mock، تكون القراءات محاكاة. وتقديرات المناخ الخارجي ليست طقسًا لحظيًا ولا بديلًا عن حساس داخل البيت الزراعي.',
    finalTitle: 'ابدأ باستكشاف لوحة SENSOURA',
    finalText: 'أنشئ حسابًا للمشاهدة، أو سجّل الدخول إذا كان لديك حساب بالفعل.',
    footer: 'SENSOURA · مراقبة زراعية ذكية',
    brandTagline: 'الزراعة الذكية',
    langButton: 'English',
    previewBadge: 'مثال',
  },
  en: {
    navAbout: 'About',
    navFeatures: 'Features',
    navHow: 'How it works',
    signIn: 'Sign in',
    signUp: 'Create account',
    badge: 'Clearer monitoring. Calmer decisions.',
    title: 'Understand what is happening in your greenhouse.',
    titleAccent: 'Act with confidence.',
    intro: 'SENSOURA brings sensor readings, system status, and recommendations into one dashboard to make greenhouse monitoring and irrigation planning easier.',
    createAccount: 'Create an account',
    explore: 'Explore the platform',
    signupNote: 'New accounts start with read-only access.',
    previewLabel: 'Illustrative preview',
    previewTitle: 'A look at the monitoring dashboard',
    previewImageCaption: 'A growing environment, seen through data',
    previewNote: 'This is an interface preview, not live telemetry.',
    sensorImageAlt: 'Generic plant sensor and soil probe among greenhouse leaves',
    greenhouseImageAlt: 'Green growing rows inside a modern greenhouse',
    irrigationImageAlt: 'Drip irrigation watering plants inside a greenhouse',
    metricAir: 'Air temperature',
    metricSoil: 'Soil moisture',
    metricLight: 'Light',
    waiting: 'Readings appear when a device is connected',
    whatTitle: 'A clearer view of what matters',
    whatIntro: 'Bring key signals together while keeping greenhouse measurements distinct from external climate context.',
    featureSensors: 'Sensor readings',
    featureSensorsText: 'Follow air and soil temperature, humidity, and light when your device reports measurements.',
    featureClimate: 'External climate context',
    featureClimateText: 'View daily climate estimates as supporting context, separate from greenhouse sensor measurements.',
    featureActions: 'Suggestions and controls',
    featureActionsText: 'Review irrigation suggestions and command status. Executing controls requires a configured device and backend.',
    detailEyebrow: 'WHAT THE PLATFORM TRACKS',
    detailTitle: 'Multiple signals. One clearer picture.',
    detailIntro: 'SENSOURA brings environmental, soil, and irrigation readings together while making each source and its limits clear instead of blending external estimates with greenhouse measurements.',
    detailEnvironmentTitle: 'Environment and air',
    detailEnvironmentText: 'When sensors are connected, follow air temperature, humidity, light, barometric pressure, and an air-quality indicator alongside greenhouse conditions.',
    detailSoilTitle: 'Soil and irrigation',
    detailSoilText: 'Soil temperature and moisture help explain plant conditions. The dashboard separates a pump request from the relay state reported by the device.',
    detailDecisionTitle: 'Reviewable insights',
    detailDecisionText: 'Estimates and suggestions help interpret trends, but they are not guarantees and do not actuate the pump automatically. Controls require permission and device acknowledgement.',
    detailFootnote: 'Real measurements appear only after sensors, backend, and data source are configured; development sample data remains clearly identified.',
    stepsTitle: 'From measurement to decision',
    step1: 'Connect the device',
    step1Text: 'Configure the ESP32, sensors, and secure connection to the backend.',
    step2: 'Monitor conditions',
    step2Text: 'Review readings, alerts, and connection status in one place.',
    step3: 'Take action',
    step3Text: 'Use recommendations or operator controls when hardware is connected.',
    aboutTitle: 'About SENSOURA',
    aboutText: 'SENSOURA is a smart-agriculture project that connects sensor data to a clear monitoring interface, helping people understand growing conditions and make data-informed decisions.',
    disclaimer: 'In Mock mode, readings are simulated. External climate estimates are not live weather and do not replace an in-greenhouse sensor.',
    finalTitle: 'Explore the SENSOURA dashboard',
    finalText: 'Create a read-only account, or sign in if you already have one.',
    footer: 'SENSOURA · Smart agriculture monitoring',
    brandTagline: 'Smart agriculture',
    langButton: 'العربية',
    previewBadge: 'SAMPLE',
  },
} as const;

const features = [
  { icon: Thermometer, image: 'sensoura-sensor-detail.png', alt: 'sensorImageAlt', title: 'featureSensors', text: 'featureSensorsText' },
  { icon: Sun, image: 'sensoura-greenhouse-hero.png', alt: 'greenhouseImageAlt', title: 'featureClimate', text: 'featureClimateText' },
  { icon: Droplets, image: 'sensoura-irrigation-detail.png', alt: 'irrigationImageAlt', title: 'featureActions', text: 'featureActionsText' },
] as const;

const steps = [
  { number: '01', title: 'step1', text: 'step1Text', icon: Leaf },
  { number: '02', title: 'step2', text: 'step2Text', icon: Activity },
  { number: '03', title: 'step3', text: 'step3Text', icon: ShieldCheck },
] as const;

export function Landing() {
  const [language, setLanguage] = useState<Language>(getPreferredLanguage);
  const t = copy[language];
  const isArabic = language === 'ar';
  const toggleLanguage = () => {
    const nextLanguage = isArabic ? 'en' : 'ar';
    setLanguage(nextLanguage);
    savePreferredLanguage(nextLanguage);
  };

  return (
    <main lang={language} dir={isArabic ? 'rtl' : 'ltr'} className="min-h-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <header className="border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-4 sm:gap-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex shrink-0 items-center gap-3" aria-label={isArabic ? 'الصفحة الرئيسية لـ SENSOURA' : 'SENSOURA home'}>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent-primary)] text-[var(--bg-primary)] shadow-[var(--shadow-glow)] sm:h-10 sm:w-10">
              <Activity className="h-5 w-5" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-base font-bold leading-tight tracking-tight sm:text-lg">SENSOURA</span>
              <span className="hidden text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-muted)] sm:block">{t.brandTagline}</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-7 text-sm text-[var(--text-secondary)] md:flex" aria-label={isArabic ? 'التنقل الرئيسي' : 'Main navigation'}>
            <a className="transition hover:text-[var(--text-primary)]" href="#features">{t.navFeatures}</a>
            <a className="transition hover:text-[var(--text-primary)]" href="#how-it-works">{t.navHow}</a>
            <a className="transition hover:text-[var(--text-primary)]" href="#about">{t.navAbout}</a>
          </nav>

          <div className="flex shrink-0 items-center gap-1 sm:gap-3">
            <ThemeToggle language={language} compact />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={toggleLanguage}
              aria-label={isArabic ? 'Switch language to English' : 'تغيير اللغة إلى العربية'}
            >
              <Globe2 className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">{t.langButton}</span>
              <span className="sm:hidden">{isArabic ? 'EN' : 'عربي'}</span>
            </button>
            <Link to="/login" className="hidden text-sm font-medium text-[var(--text-secondary)] transition hover:text-[var(--text-primary)] sm:inline-flex">
              {t.signIn}
            </Link>
            <Link to="/signup" className="btn btn-primary btn-sm">
              <span className="hidden sm:inline">{t.signUp}</span>
              <span className="sm:hidden">{isArabic ? 'حساب' : 'Join'}</span>
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </header>

      <section className="relative isolate">
        <div className="sensoura-aurora pointer-events-none absolute inset-0 -z-10 opacity-70" aria-hidden="true" style={{ background: 'radial-gradient(ellipse at 72% 22%, rgba(0, 212, 170, .13), transparent 42%), radial-gradient(ellipse at 15% 80%, rgba(6, 182, 212, .08), transparent 35%)' }} />
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1.05fr_.95fr] lg:px-8 lg:py-28">
          <ScrollReveal className="w-full">
            <p className="inline-flex items-center gap-2 rounded-full border border-[var(--border-accent)]/30 bg-[var(--accent-primary)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--accent-primary)]">
              <span className="sensoura-badge-pulse h-1.5 w-1.5 rounded-full bg-[var(--accent-primary)]" aria-hidden="true" />
              {t.badge}
            </p>
            <h1 className="mt-6 max-w-3xl text-4xl font-bold leading-[1.12] tracking-tight sm:text-5xl lg:text-6xl">
              {t.title}<br />
              <span className="text-[var(--accent-primary)]">{t.titleAccent}</span>
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-[var(--text-secondary)] sm:text-lg">
              {t.intro}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link to="/signup" className="btn btn-primary btn-lg">
                {t.createAccount}
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <a href="#features" className="btn btn-secondary btn-lg">
                {t.explore}
                <ArrowDown className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>
            <p className="mt-4 flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <ShieldCheck className="h-4 w-4 text-[var(--accent-primary)]" aria-hidden="true" />
              {t.signupNote}
            </p>
          </ScrollReveal>

          <ScrollReveal className="relative w-full" delayMs={140}>
            <div className="pointer-events-none absolute -inset-5 -z-10 rounded-[2rem] bg-[var(--accent-primary)]/10 blur-3xl" aria-hidden="true" />
            <div className="card sensoura-card-lift overflow-hidden rounded-2xl border-[var(--border-secondary)] bg-[var(--bg-secondary)]/95 p-5 shadow-[var(--shadow-lg)] sm:p-7">
              <figure className="sensoura-image-frame relative mb-5 h-44 overflow-hidden rounded-xl border border-[var(--border-primary)] sm:h-52">
                <img
                  src={`${import.meta.env.BASE_URL}sensoura-greenhouse-hero.png`}
                  alt={t.greenhouseImageAlt}
                  className="h-full w-full object-cover"
                  fetchPriority="high"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/75 via-slate-950/5 to-transparent" />
                <figcaption className="absolute inset-x-4 bottom-3 z-10 text-sm font-medium text-white">{t.previewImageCaption}</figcaption>
              </figure>
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border-primary)] pb-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">{t.previewLabel}</p>
                  <h2 className="mt-2 text-xl font-semibold">{t.previewTitle}</h2>
                </div>
                <span className="badge badge-neutral">{t.previewBadge}</span>
              </div>
              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {[
                  { icon: Thermometer, label: t.metricAir },
                  { icon: Waves, label: t.metricSoil },
                  { icon: Sun, label: t.metricLight },
                ].map(({ icon: Icon, label }) => (
                  <div key={label} className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-tertiary)] p-4">
                    <div className="flex items-center justify-between gap-2 text-[var(--text-muted)]">
                      <span className="text-xs">{label}</span>
                      <Icon className="h-4 w-4 text-[var(--accent-primary)]" aria-hidden="true" />
                    </div>
                    <p className="mt-3 font-mono text-2xl text-[var(--text-secondary)]">—</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-3 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-tertiary)]/70 p-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]">
                  <Activity className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-medium">{t.waiting}</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{t.previewNote}</p>
                </div>
              </div>
            </div>
          </ScrollReveal>
        </div>
      </section>

      <section id="features" className="scroll-mt-8 border-y border-[var(--border-primary)] bg-[var(--bg-secondary)]/45">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
          <ScrollReveal className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-primary)]">SENSOURA / {isArabic ? 'المزايا' : 'CAPABILITIES'}</p>
            <h2 className="mt-3 text-3xl font-bold sm:text-4xl">{t.whatTitle}</h2>
            <p className="mt-4 leading-7 text-[var(--text-secondary)]">{t.whatIntro}</p>
          </ScrollReveal>
          <div className="mt-9 grid gap-4 md:grid-cols-3">
            {features.map(({ icon: Icon, image, alt, title, text }, index) => (
              <ScrollReveal key={title} className="h-full" delayMs={index * 110}>
                <article className="card sensoura-card-lift h-full rounded-2xl bg-[var(--bg-card)] p-6">
                  <div className="sensoura-image-frame mb-5 h-36 overflow-hidden rounded-xl border border-[var(--border-primary)]">
                    <img
                      src={`${import.meta.env.BASE_URL}${image}`}
                      alt={t[alt]}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border-accent)]/30 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h3 className="mt-5 text-lg font-semibold">{t[title]}</h3>
                  <p className="mt-2 text-sm leading-7 text-[var(--text-secondary)]">{t[text]}</p>
                </article>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      <section id="system-details" className="scroll-mt-8 border-b border-[var(--border-primary)]">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
          <ScrollReveal className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-primary)]">{t.detailEyebrow}</p>
            <h2 className="mt-3 text-3xl font-bold sm:text-4xl">{t.detailTitle}</h2>
            <p className="mt-4 leading-7 text-[var(--text-secondary)]">{t.detailIntro}</p>
          </ScrollReveal>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              { number: '01', Icon: Thermometer, title: t.detailEnvironmentTitle, text: t.detailEnvironmentText },
              { number: '02', Icon: Droplets, title: t.detailSoilTitle, text: t.detailSoilText },
              { number: '03', Icon: ShieldCheck, title: t.detailDecisionTitle, text: t.detailDecisionText },
            ].map(({ number, Icon, title, text }, index) => (
              <ScrollReveal key={number} className="h-full" delayMs={index * 100}>
                <article className="h-full rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-[var(--accent-primary)]">{number}</span>
                    <Icon className="h-5 w-5 text-[var(--accent-primary)]" aria-hidden="true" />
                  </div>
                  <h3 className="mt-5 text-lg font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-7 text-[var(--text-secondary)]">{text}</p>
                </article>
              </ScrollReveal>
            ))}
          </div>
          <p className="mt-5 text-xs leading-6 text-[var(--text-muted)]">{t.detailFootnote}</p>
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-8">
        <ScrollReveal className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-primary)]">{isArabic ? 'رحلة الاستخدام' : 'THE WORKFLOW'}</p>
              <h2 className="mt-3 text-3xl font-bold sm:text-4xl">{t.stepsTitle}</h2>
            </div>
            <span className="hidden h-px flex-1 bg-gradient-to-l from-[var(--border-accent)]/50 to-transparent sm:block" aria-hidden="true" />
          </div>
          <div className="mt-9 grid gap-4 md:grid-cols-3">
            {steps.map(({ number, title, text, icon: Icon }, index) => (
              <ScrollReveal key={number} className="h-full" delayMs={index * 110}>
                <article className="relative h-full rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm text-[var(--accent-primary)]">{number}</span>
                    <Icon className="h-5 w-5 text-[var(--text-muted)]" aria-hidden="true" />
                  </div>
                  <h3 className="mt-6 text-lg font-semibold">{t[title]}</h3>
                  <p className="mt-2 text-sm leading-7 text-[var(--text-secondary)]">{t[text]}</p>
                </article>
              </ScrollReveal>
            ))}
          </div>
        </ScrollReveal>
      </section>

      <section id="about" className="scroll-mt-8 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]/45">
        <ScrollReveal className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[.8fr_1.2fr] lg:px-8 lg:py-20">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-primary)]">{isArabic ? 'من نحن' : 'WHO WE ARE'}</p>
            <h2 className="mt-3 text-3xl font-bold">{t.aboutTitle}</h2>
          </div>
          <div>
            <p className="text-lg leading-8 text-[var(--text-secondary)]">{t.aboutText}</p>
            <p className="mt-5 rounded-xl border border-[var(--accent-warning)]/25 bg-[var(--accent-warning)]/5 p-4 text-sm leading-7 text-[var(--text-secondary)]">{t.disclaimer}</p>
          </div>
        </ScrollReveal>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <ScrollReveal className="flex flex-col items-start justify-between gap-6 rounded-2xl border border-[var(--border-accent)]/30 bg-gradient-to-br from-[var(--bg-tertiary)] to-[var(--bg-secondary)] p-7 shadow-[var(--shadow-glow)] sm:flex-row sm:items-center sm:p-10">
          <div>
            <h2 className="text-2xl font-bold sm:text-3xl">{t.finalTitle}</h2>
            <p className="mt-3 max-w-2xl leading-7 text-[var(--text-secondary)]">{t.finalText}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <Link to="/signup" className="btn btn-primary btn-lg">
              {t.signUp}
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link to="/login" className="btn btn-secondary btn-lg">{t.signIn}</Link>
          </div>
        </ScrollReveal>
      </section>

      <footer className="border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]/70">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-6 text-xs text-[var(--text-muted)] sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <span>{t.footer}</span>
          <span>{t.previewNote}</span>
        </div>
      </footer>
    </main>
  );
}
