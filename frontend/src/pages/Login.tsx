import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Activity, ArrowUpRight, Droplets, Github, Globe2, Leaf, LogIn, UserPlus } from 'lucide-react';
import { resendFirebaseVerificationLink, signInWithEmailPassword, signInWithGitHub, signInWithGoogle, signUpWithEmailPassword } from '@services/authToken';
import { getPreferredLanguage, savePreferredLanguage, type Language } from '@services/language';
import { ThemeToggle } from '@components/ThemeToggle';

type AuthMode = 'sign-in' | 'sign-up';

const messages = {
  ar: {
    home: 'الرئيسية',
    titleLogin: 'أهلًا بعودتك',
    titleSignup: 'أنشئ حسابك',
    loginIntro: 'سجّل الدخول إلى لوحة SENSOURA بالبريد وكلمة المرور، أو تابع باستخدام Google أو GitHub.',
    signupIntro: 'أنشئ حسابًا لمشاهدة لوحة SENSOURA. يلزم تأكيد البريد قبل الدخول، ونحظر نطاقات البريد المؤقت المعروفة. الحسابات الجديدة للقراءة فقط.',
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    confirmPassword: 'تأكيد كلمة المرور',
    loginButton: 'تسجيل الدخول',
    signupButton: 'إنشاء الحساب',
    submittingLogin: 'جارٍ تسجيل الدخول…',
    submittingSignup: 'جارٍ إنشاء الحساب…',
    githubButton: 'المتابعة باستخدام GitHub',
    githubPending: 'جارٍ الاتصال بـGitHub…',
    googleButton: 'المتابعة باستخدام Google',
    googlePending: 'جارٍ الاتصال بـGoogle…',
    or: 'أو',
    githubFailed: 'تعذّر تسجيل الدخول عبر GitHub. تحقّق من إعدادات Firebase.',
    googleFailed: 'تعذّر تسجيل الدخول عبر Google. تحقّق من إعدادات Firebase.',
    promoEyebrow: 'الزراعة الذكية',
    promoTitle: 'صورة أوضح لبيئتك الزراعية.',
    promoBody: 'تابع قراءات البيت الزراعي وحالة النظام والتوصيات من مكان واحد.',
    promoSensors: 'قراءات الحساسات',
    promoIrrigation: 'متابعة الري',
    promoInsights: 'توصيات ذكية',
    promoNote: 'صورة توضيحية. تظهر البيانات الحية بعد إعداد الجهاز والخادم.',
    noAccount: 'ليس لديك حساب؟',
    hasAccount: 'لديك حساب بالفعل؟',
    goSignup: 'أنشئ حسابًا',
    goLogin: 'سجّل الدخول',
    viewerNotice: 'لا يمكن للحساب الجديد تشغيل الأجهزة. صلاحيات المشغّل أو المسؤول يمنحها مسؤول المشروع فقط.',
    emailVerificationNotice: 'بعد التسجيل، افتح رابط التأكيد الذي يصلك من SENSOURA عبر بريدنا الرسمي ثم عُد لتسجيل الدخول. نطاقات البريد المؤقت المعروفة محظورة، لكن القائمة لا تشمل كل الخدمات.',
    verificationSent: 'أرسلنا رابط تأكيد إلى بريدك. افتحه ثم ارجع إلى هذه الصفحة لتسجيل الدخول.',
    verificationTitle: 'أكّد بريدك الإلكتروني',
    verificationIntro: 'افتح رابط SENSOURA في رسالة بريدك لتأكيد العنوان، ثم ارجع وسجّل الدخول.',
    verifyEmailButton: 'أكدت بريدي، متابعة',
    verifyingEmail: 'جارٍ التحقق من البريد…',
    verificationRequired: 'أرسلنا رابط التأكيد إلى هذا البريد. افحص صندوق الوارد والبريد غير المرغوب فيه:',
    resendVerification: 'إعادة إرسال رابط التأكيد',
    resendingVerification: 'جارٍ إرسال الرابط…',
    verificationResent: 'أرسلنا رابط تأكيد جديدًا. استخدم أحدث رسالة وصلتك.',
    emailVerifiedReturn: 'تم الرجوع من رابط Firebase. سجّل الدخول للمتابعة إلى اللوحة.',
    passwordMismatch: 'كلمتا المرور غير متطابقتين.',
    loginFailed: 'تعذّر تسجيل الدخول. تحقّق من البريد وكلمة المرور.',
    signupFailed: 'تعذّر إنشاء الحساب. تحقّق من البيانات وإعدادات Firebase.',
    languageButton: 'English',
    errorMap: {
      'Firebase sign-in is not configured. Set VITE_FIREBASE_API_KEY for this build.': 'تسجيل الدخول غير مهيأ. أضف VITE_FIREBASE_API_KEY إلى إعدادات بناء الواجهة.',
      'Firebase sign-up is not configured. Set VITE_FIREBASE_API_KEY for this build.': 'التسجيل غير مهيأ. أضف VITE_FIREBASE_API_KEY إلى إعدادات بناء الواجهة.',
      'Email or password is incorrect': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
      'This account has been disabled': 'تم تعطيل هذا الحساب.',
      'Email/password sign-in is not enabled in Firebase': 'تسجيل الدخول بالبريد وكلمة المرور غير مفعّل في Firebase.',
      'Email/password account creation is not enabled in Firebase': 'إنشاء الحسابات بالبريد وكلمة المرور غير مفعّل في Firebase.',
      'The Firebase Web API key is invalid': 'مفتاح Firebase Web API غير صالح.',
      'An account with this email already exists': 'يوجد حساب مسجل بهذا البريد الإلكتروني بالفعل.',
      'Enter a valid email address': 'أدخل بريدًا إلكترونيًا صالحًا.',
      'Use a password with at least 6 characters': 'استخدم كلمة مرور من 6 أحرف على الأقل.',
      'Use a stronger password with at least 6 characters': 'استخدم كلمة مرور أقوى من 6 أحرف على الأقل.',
      'The browser could not store the Firebase session': 'تعذّر حفظ جلسة Firebase في المتصفح.',
      'Firebase GitHub sign-in is not configured. Set VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, and VITE_FIREBASE_PROJECT_ID for this build.': 'تسجيل GitHub غير مهيأ. أضف إعدادات Firebase المطلوبة إلى الواجهة.',
      'GitHub sign-in was cancelled': 'تم إلغاء تسجيل الدخول عبر GitHub.',
      'GitHub sign-in popup was blocked': 'منع المتصفح نافذة GitHub المنبثقة. اسمح بالنوافذ المنبثقة ثم أعد المحاولة.',
      'This domain is not authorized for GitHub sign-in': 'أضف نطاق الموقع إلى Firebase Authentication ثم Authorized domains.',
      'GitHub sign-in is not enabled in Firebase': 'مزود GitHub غير مفعّل في Firebase.',
      'An account with this email already exists with a different sign-in method': 'هذا البريد مرتبط بطريقة دخول أخرى. سجّل الدخول بها أولًا.',
      'GitHub sign-in failed. Check the Firebase provider configuration.': 'تعذّر تسجيل الدخول عبر GitHub. تحقّق من إعدادات المزود في Firebase.',
      'GitHub sign-in did not return a valid Firebase session': 'لم تُنشأ جلسة Firebase صالحة لتسجيل GitHub.',
      'Firebase Google sign-in is not configured. Set VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, and VITE_FIREBASE_PROJECT_ID for this build.': 'تسجيل Google غير مهيأ. أضف إعدادات Firebase المطلوبة إلى الواجهة.',
      'Google sign-in was cancelled': 'تم إلغاء تسجيل الدخول عبر Google.',
      'Google sign-in popup was blocked': 'منع المتصفح نافذة Google المنبثقة. اسمح بالنوافذ المنبثقة ثم أعد المحاولة.',
      'This domain is not authorized for OAuth sign-in': 'أضف نطاق الموقع إلى Firebase Authentication ثم Authorized domains.',
      'Google sign-in is not enabled in Firebase': 'مزود Google غير مفعّل في Firebase.',
      'Google sign-in failed. Check the Firebase provider configuration.': 'تعذّر تسجيل الدخول عبر Google. تحقّق من إعدادات المزود في Firebase.',
      'OAuth sign-in did not return a valid Firebase session': 'لم تُنشأ جلسة Firebase صالحة لتسجيل الدخول.',
      'Disposable email addresses are not allowed': 'لا يُسمح باستخدام نطاقات البريد المؤقت المعروفة.',
      'Email is not verified': 'البريد غير مؤكد بعد. أرسلنا رابط التأكيد؛ افتحه ثم ارجع لتسجيل الدخول.',
      'OAuth provider email is not verified': 'البريد لدى Google أو GitHub غير مؤكد. استخدم حسابًا ببريد مؤكد أو سجّل بالبريد وكلمة المرور.',
      'A verified email address is required': 'يتطلب تسجيل الدخول بريدًا إلكترونيًا مرتبطًا ومؤكدًا.',
      'Email is already verified': 'تم تأكيد البريد بالفعل. سجّل الدخول الآن.',
      'Email verification is not enabled in Firebase': 'فعّل Email address verification من إعدادات Firebase Authentication.',
      'Email verification return URL is not authorized in Firebase': 'أضف نطاق الموقع إلى Firebase Authentication ثم Authorized domains.',
      'Email verification service is unavailable': 'تعذّر الاتصال بخدمة Firebase لإرسال رابط التأكيد. حاول لاحقًا.',
      'Verification link could not be sent': 'تعذّر إرسال رابط التأكيد. تحقق من إعدادات Firebase وحاول مجددًا.',
      'Could not sign in to resend the verification link': 'تعذّر تسجيل الدخول لإعادة إرسال الرابط. تحقق من البريد وكلمة المرور.',
    },
  },
  en: {
    home: 'Home',
    titleLogin: 'Welcome back',
    titleSignup: 'Create your account',
    loginIntro: 'Sign in to the SENSOURA dashboard with email and password, or continue with Google or GitHub.',
    signupIntro: 'Create an account to view the SENSOURA dashboard. Verify your email before access; known disposable domains are blocked. New accounts are read-only.',
    email: 'Email address',
    password: 'Password',
    confirmPassword: 'Confirm password',
    loginButton: 'Sign in',
    signupButton: 'Create account',
    submittingLogin: 'Signing in…',
    submittingSignup: 'Creating account…',
    githubButton: 'Continue with GitHub',
    githubPending: 'Connecting to GitHub…',
    googleButton: 'Continue with Google',
    googlePending: 'Connecting to Google…',
    or: 'or',
    githubFailed: 'GitHub sign-in failed. Check the Firebase provider settings.',
    googleFailed: 'Google sign-in failed. Check the Firebase provider settings.',
    promoEyebrow: 'SMART AGRICULTURE',
    promoTitle: 'A clearer view of your growing environment.',
    promoBody: 'Follow greenhouse readings, system status, and recommendations in one place.',
    promoSensors: 'Sensor readings',
    promoIrrigation: 'Irrigation monitoring',
    promoInsights: 'Smart recommendations',
    promoNote: 'Illustrative image. Live data appears after the device and backend are configured.',
    noAccount: 'New to SENSOURA?',
    hasAccount: 'Already have an account?',
    goSignup: 'Create an account',
    goLogin: 'Sign in',
    viewerNotice: 'New accounts cannot control devices. Only a project administrator can grant operator or admin access.',
    emailVerificationNotice: 'After signing up, open the SENSOURA verification link sent from our official email, then return here to sign in. Known disposable domains are blocked, but the list is not exhaustive.',
    verificationSent: 'We sent a verification link to your email. Open it, then return here to sign in.',
    verificationTitle: 'Verify your email',
    verificationIntro: 'Open the SENSOURA link in your email to verify the address, then return and sign in.',
    verifyEmailButton: 'I verified my email — continue',
    verifyingEmail: 'Checking email status…',
    verificationRequired: 'We sent the verification link to this address. Check your inbox and spam folder:',
    resendVerification: 'Resend verification link',
    resendingVerification: 'Sending link…',
    verificationResent: 'A new verification link was sent. Use the latest email.',
    emailVerifiedReturn: 'You returned from the Firebase link. Sign in to continue to the dashboard.',
    passwordMismatch: 'The passwords do not match.',
    loginFailed: 'Sign-in failed. Check your email and password.',
    signupFailed: 'Account creation failed. Check the details and Firebase configuration.',
    languageButton: 'العربية',
    errorMap: {
      'Firebase sign-in is not configured. Set VITE_FIREBASE_API_KEY for this build.': 'Firebase sign-in is not configured. Add VITE_FIREBASE_API_KEY to the frontend build settings.',
      'Firebase sign-up is not configured. Set VITE_FIREBASE_API_KEY for this build.': 'Firebase sign-up is not configured. Add VITE_FIREBASE_API_KEY to the frontend build settings.',
      'Email or password is incorrect': 'Email or password is incorrect.',
      'This account has been disabled': 'This account has been disabled.',
      'Email/password sign-in is not enabled in Firebase': 'Email/password sign-in is not enabled in Firebase.',
      'Email/password account creation is not enabled in Firebase': 'Email/password account creation is not enabled in Firebase.',
      'The Firebase Web API key is invalid': 'The Firebase Web API key is invalid.',
      'An account with this email already exists': 'An account with this email already exists.',
      'Enter a valid email address': 'Enter a valid email address.',
      'Use a password with at least 6 characters': 'Use a password with at least 6 characters.',
      'Use a stronger password with at least 6 characters': 'Use a stronger password with at least 6 characters.',
      'The browser could not store the Firebase session': 'The browser could not store the Firebase session.',
      'Firebase GitHub sign-in is not configured. Set VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, and VITE_FIREBASE_PROJECT_ID for this build.': 'Firebase GitHub sign-in is not configured. Set the required Firebase frontend settings.',
      'GitHub sign-in was cancelled': 'GitHub sign-in was cancelled.',
      'GitHub sign-in popup was blocked': 'The browser blocked the GitHub popup. Allow popups and try again.',
      'This domain is not authorized for GitHub sign-in': 'Add this site domain under Firebase Authentication > Settings > Authorized domains.',
      'GitHub sign-in is not enabled in Firebase': 'GitHub sign-in is not enabled in Firebase.',
      'An account with this email already exists with a different sign-in method': 'This email already uses another sign-in method. Sign in with that method first.',
      'GitHub sign-in failed. Check the Firebase provider configuration.': 'GitHub sign-in failed. Check the Firebase provider settings.',
      'GitHub sign-in did not return a valid Firebase session': 'GitHub sign-in did not return a valid Firebase session.',
      'Firebase Google sign-in is not configured. Set VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, and VITE_FIREBASE_PROJECT_ID for this build.': 'Firebase Google sign-in is not configured. Set the required Firebase frontend settings.',
      'Google sign-in was cancelled': 'Google sign-in was cancelled.',
      'Google sign-in popup was blocked': 'The browser blocked the Google popup. Allow popups and try again.',
      'This domain is not authorized for OAuth sign-in': 'Add this site domain under Firebase Authentication > Settings > Authorized domains.',
      'Google sign-in is not enabled in Firebase': 'Google sign-in is not enabled in Firebase.',
      'Google sign-in failed. Check the Firebase provider configuration.': 'Google sign-in failed. Check the Firebase provider settings.',
      'OAuth sign-in did not return a valid Firebase session': 'OAuth sign-in did not return a valid Firebase session.',
      'Disposable email addresses are not allowed': 'Known disposable email domains are not allowed.',
      'Email is not verified': 'Your email is not verified yet. We sent a verification link; open it, then return to sign in.',
      'OAuth provider email is not verified': 'Google or GitHub did not verify this email. Use a provider-verified email or sign up with email and password.',
      'A verified email address is required': 'Sign-in requires an associated, verified email address.',
      'Email is already verified': 'Your email is already verified. Sign in now.',
      'Email verification is not enabled in Firebase': 'Enable Email address verification in Firebase Authentication settings.',
      'Email verification return URL is not authorized in Firebase': 'Add this site under Firebase Authentication > Settings > Authorized domains.',
      'Email verification service is unavailable': 'Could not reach Firebase to send the verification link. Try again later.',
      'Verification link could not be sent': 'Could not send the verification link. Check Firebase settings and try again.',
      'Could not sign in to resend the verification link': 'Could not sign in to resend the link. Check your email and password.',
    },
  },
} as const;

export function Login({ initialMode = 'sign-in' }: { initialMode?: AuthMode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  useEffect(() => setMode(initialMode), [initialMode]);
  const [language, setLanguage] = useState<Language>(getPreferredLanguage);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [verificationPending, setVerificationPending] = useState(false);
  const [resendingVerification, setResendingVerification] = useState(false);
  const [activeProvider, setActiveProvider] = useState<'google' | 'github' | null>(null);
  const providerSubmitting = activeProvider !== null;
  const isArabic = language === 'ar';
  const isSignUp = mode === 'sign-up';
  const t = messages[language];
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/dashboard';
  useEffect(() => {
    if (new URLSearchParams(location.search).get('emailVerified') === '1') {
      setNotice(messages[language].emailVerifiedReturn);
    }
  }, [language, location.search]);
  const toggleLanguage = () => {
    const nextLanguage = isArabic ? 'en' : 'ar';
    setLanguage(nextLanguage);
    savePreferredLanguage(nextLanguage);
  };

  const changeMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setPassword('');
    setConfirmPassword('');
    setError(null);
    setNotice(null);
    setVerificationPending(false);
    navigate(nextMode === 'sign-up' ? '/signup' : '/login', { replace: true });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setVerificationPending(false);
    if (isSignUp && password !== confirmPassword) {
      setError(t.passwordMismatch);
      return;
    }

    setSubmitting(true);
    try {
      if (isSignUp) {
        await signUpWithEmailPassword(email.trim(), password);
        setVerificationPending(true);
        setNotice(t.verificationSent);
        return;
      }
      await signInWithEmailPassword(email.trim(), password);
      navigate(from, { replace: true });
    } catch (cause) {
      const message = cause instanceof Error
        ? cause.message
        : (isSignUp ? t.signupFailed : t.loginFailed);
      const verificationErrors = [
        'Email is not verified',
        'Verification link could not be sent',
        'Email verification service is unavailable',
        'Email verification is not enabled in Firebase',
        'Email verification return URL is not authorized in Firebase',
      ];
      if (verificationErrors.includes(message)) {
        setVerificationPending(true);
        if (message === 'Email is not verified') setNotice(t.verificationSent);
      }
      setError(isArabic ? (t.errorMap[message as keyof typeof t.errorMap] ?? t[isSignUp ? 'signupFailed' : 'loginFailed']) : message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSocialSignIn = async (provider: 'google' | 'github') => {
    setError(null);
    setNotice(null);
    setVerificationPending(false);
    setActiveProvider(provider);
    try {
      if (provider === 'google') await signInWithGoogle();
      else await signInWithGitHub();
      navigate(from, { replace: true });
    } catch (cause) {
      const fallback = provider === 'google' ? t.googleFailed : t.githubFailed;
      const message = cause instanceof Error ? cause.message : fallback;
      setError(isArabic ? (t.errorMap[message as keyof typeof t.errorMap] ?? fallback) : message);
    } finally {
      setActiveProvider(null);
    }
  };

  const handleResendVerification = async () => {
    setError(null);
    setNotice(null);
    setResendingVerification(true);
    try {
      await resendFirebaseVerificationLink(email.trim(), password);
      setVerificationPending(true);
      setNotice(t.verificationResent);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t.loginFailed;
      setError(isArabic ? (t.errorMap[message as keyof typeof t.errorMap] ?? t.loginFailed) : message);
    } finally {
      setResendingVerification(false);
    }
  };

  const handleContinueAfterVerification = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      await signInWithEmailPassword(email.trim(), password);
      navigate(from, { replace: true });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t.loginFailed;
      setVerificationPending(true);
      if (message === 'Email is not verified') setNotice(t.verificationSent);
      setError(isArabic ? (t.errorMap[message as keyof typeof t.errorMap] ?? t.loginFailed) : message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main lang={language} dir={isArabic ? 'rtl' : 'ltr'} className="relative mx-auto grid min-h-screen w-full max-w-6xl grid-cols-1 items-center justify-items-center gap-8 overflow-x-hidden bg-[var(--bg-primary)] p-4 py-8 text-[var(--text-primary)] lg:grid-cols-[minmax(25rem,29rem)_minmax(0,1fr)]">
      <div className="pointer-events-none fixed inset-0 opacity-60" aria-hidden="true" style={{ background: 'radial-gradient(ellipse at 20% 20%, rgba(0, 212, 170, .1), transparent 42%)' }} />
      <section className="card relative z-10 w-full max-w-md space-y-6 rounded-2xl bg-[var(--bg-secondary)] p-6 shadow-[var(--shadow-lg)] sm:p-8">
        <div className="flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-3" aria-label={isArabic ? 'العودة للرئيسية' : 'Back to home'}>
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--accent-primary)] text-[var(--bg-primary)]">
              <Activity className="h-6 w-6" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-xs font-mono tracking-[0.16em] text-[var(--accent-primary)]">SENSOURA</span>
              <span className="block text-xs text-[var(--text-muted)]">{t.home}</span>
            </span>
          </Link>
          <div className="flex items-center gap-1">
            <ThemeToggle language={language} compact />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={toggleLanguage}
              aria-label={isArabic ? 'Switch language to English' : 'تغيير اللغة إلى العربية'}
            >
              <Globe2 className="h-4 w-4" aria-hidden="true" />
              {t.languageButton}
            </button>
          </div>
        </div>

        <div>
          <h1 className="text-2xl font-bold">{verificationPending ? t.verificationTitle : (isSignUp ? t.titleSignup : t.titleLogin)}</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{verificationPending ? t.verificationIntro : (isSignUp ? t.signupIntro : t.loginIntro)}</p>
        </div>

        {verificationPending ? (
          <form className="space-y-4" onSubmit={handleContinueAfterVerification}>
            <p className="text-sm leading-6 text-[var(--text-secondary)]" role="status">{t.verificationRequired} <span className="font-medium text-[var(--text-primary)]">{email}</span></p>
            {error && <p className="rounded-lg border border-[var(--accent-danger)]/25 bg-[var(--accent-danger)]/5 p-3 text-sm text-[var(--accent-danger)]" role="alert">{error}</p>}
            <button className="btn btn-primary w-full" type="submit" disabled={submitting || resendingVerification || !email.trim() || !password}>
              {submitting ? t.verifyingEmail : t.verifyEmailButton}
            </button>
            <button className="btn btn-secondary w-full" type="button" onClick={() => void handleResendVerification()} disabled={submitting || resendingVerification || !email.trim() || !password}>
              {resendingVerification ? t.resendingVerification : t.resendVerification}
            </button>
          </form>
        ) : <form className="space-y-4" onSubmit={handleSubmit}>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{t.email}</span>
            <input
              className="input"
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{t.password}</span>
            <input
              className="input"
              type="password"
              name="password"
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              minLength={isSignUp ? 6 : undefined}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {isSignUp && (
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">{t.confirmPassword}</span>
              <input
                className="input"
                type="password"
                name="confirmPassword"
                autoComplete="new-password"
                minLength={6}
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
          )}

          {error && <p className="rounded-lg border border-[var(--accent-danger)]/25 bg-[var(--accent-danger)]/5 p-3 text-sm text-[var(--accent-danger)]" role="alert">{error}</p>}

          <button className="btn btn-primary w-full" type="submit" disabled={submitting || providerSubmitting}>
            {isSignUp ? <UserPlus className="h-4 w-4" aria-hidden="true" /> : <LogIn className="h-4 w-4" aria-hidden="true" />}
            {submitting ? (isSignUp ? t.submittingSignup : t.submittingLogin) : (isSignUp ? t.signupButton : t.loginButton)}
            {!submitting && <ArrowUpRight className="h-4 w-4" aria-hidden="true" />}
          </button>
        </form>}

        {notice && <p className="rounded-lg border border-[var(--border-accent)]/35 bg-[var(--accent-primary)]/5 p-3 text-sm leading-6 text-[var(--text-secondary)]" role="status">{notice}</p>}

        {!verificationPending && <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
          <span className="h-px flex-1 bg-[var(--border-primary)]" aria-hidden="true" />
          <span>{t.or}</span>
          <span className="h-px flex-1 bg-[var(--border-primary)]" aria-hidden="true" />
        </div>}

        {!verificationPending && <div className="space-y-3">
          <button
            className="btn btn-secondary w-full"
            type="button"
            onClick={() => handleSocialSignIn('google')}
            disabled={submitting || providerSubmitting}
            aria-busy={activeProvider === 'google'}
          >
            <span className="text-lg font-bold text-[#4285f4]" aria-hidden="true">G</span>
            {activeProvider === 'google' ? t.googlePending : t.googleButton}
          </button>
          <button
            className="btn btn-secondary w-full"
            type="button"
            onClick={() => handleSocialSignIn('github')}
            disabled={submitting || providerSubmitting}
            aria-busy={activeProvider === 'github'}
          >
            <Github className="h-4 w-4" aria-hidden="true" />
            {activeProvider === 'github' ? t.githubPending : t.githubButton}
          </button>
        </div>}

        {isSignUp && !verificationPending && <>
          <p className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-tertiary)] p-3 text-xs leading-6 text-[var(--text-secondary)]">{t.viewerNotice}</p>
          <p className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-tertiary)] p-3 text-xs leading-6 text-[var(--text-muted)]">{t.emailVerificationNotice}</p>
        </>}

        <div className="border-t border-[var(--border-primary)] pt-4 text-center text-sm text-[var(--text-muted)]">
          <span>{isSignUp ? t.hasAccount : t.noAccount}</span>{' '}
          <button
            type="button"
            className="font-semibold text-[var(--accent-primary)] hover:underline disabled:opacity-50"
            disabled={submitting || providerSubmitting}
            onClick={() => changeMode(isSignUp ? 'sign-in' : 'sign-up')}
          >
            {isSignUp ? t.goLogin : t.goSignup}
          </button>
        </div>
      </section>

      <aside className="relative z-10 hidden min-h-[560px] w-full flex-col overflow-hidden rounded-2xl border border-[var(--border-primary)] shadow-[var(--shadow-lg)] lg:flex" dir={isArabic ? 'rtl' : 'ltr'}>
        <img
          src={`${import.meta.env.BASE_URL}sensoura-greenhouse-hero.png`}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-[#030712]/95 via-[#030712]/65 to-[#030712]/35" aria-hidden="true" />
        <div className="relative z-10 flex h-full min-h-[560px] flex-col justify-between p-8 xl:p-10">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/25 px-3 py-1.5 text-xs font-semibold tracking-wide text-white/90 backdrop-blur-sm">
              <Leaf className="h-4 w-4 text-[#00d4aa]" aria-hidden="true" />
              {t.promoEyebrow}
            </div>
            <h2 className="mt-8 max-w-xl text-3xl font-bold leading-tight text-white xl:text-4xl">{t.promoTitle}</h2>
            <p className="mt-4 max-w-lg text-sm leading-7 text-white/75 xl:text-base">{t.promoBody}</p>

            <div className="mt-8 space-y-3">
              {[
                { Icon: Activity, label: t.promoSensors },
                { Icon: Droplets, label: t.promoIrrigation },
                { Icon: Leaf, label: t.promoInsights },
              ].map(({ Icon, label }) => (
                <div key={label} className="flex items-center gap-3 rounded-xl border border-white/15 bg-black/20 px-4 py-3 text-sm font-medium text-white/90 backdrop-blur-sm">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#00d4aa]/15 text-[#00d4aa]">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  {label}
                </div>
              ))}
            </div>
          </div>
          <p className="mt-10 max-w-md text-xs leading-6 text-white/65">{t.promoNote}</p>
        </div>
      </aside>
    </main>
  );
}
