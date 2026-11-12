import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Globe2,
  Leaf,
  Loader2,
  Mail,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { applyFirebaseActionCode, checkFirebaseActionCode } from '@services/authToken';
import { useLanguage } from '@contexts/LanguageContext';
import { ThemeToggle } from '@components/ThemeToggle';

type VerificationState = 'ready' | 'verifying' | 'success' | 'already_verified' | 'expired' | 'invalid';

const copy = {
  ar: {
    brandName: 'SENSOURA',
    brandSub: 'أنظمة الزراعة الذكية والمراقبة الفضائية',
    accountVerification: 'توثيق الحساب',
    home: 'الرئيسية',
    login: 'تسجيل الدخول',
    readyTitle: 'تأكيد البريد الإلكتروني.',
    readyDesc: 'خطوة أخيرة لتفعيل حسابك في SENSOURA والبدء في استخدام لوحة تحكم الزراعة الذكية.',
    readyButton: 'إكمال التوثيق ←',
    verifyingTitle: 'جارٍ توثيق بريدك الإلكتروني…',
    verifyingDesc: 'يرجى الانتظار، نتحقق الآن من رمز التأكيد الأمني لدى خوادم التوثيق.',
    successBadge: 'حساب مفعل وموثق بنجاح ✨',
    successTitle: 'تم تأكيد البريد الإلكتروني بنجاح! ✨',
    successDesc: 'أهلًا بك في منظومة SENSOURA للزراعة الذكية. تم توثيق حسابك في Firebase Authentication بنجاح، ويمكنك الآن الدخول والوصول إلى لوحة المراقبة الحية للحساسات وتوصيات الذكاء الاصطناعي.',
    successCta: 'المتابعة لتسجيل الدخول ←',
    alreadyBadge: 'تم التوثيق مسبقًا',
    alreadyTitle: 'البريد الإلكتروني مؤكد بالفعل',
    alreadyDesc: 'تم توثيق عنوان البريد الإلكتروني هذا في وقت سابق وهو جاهز للاستخدام الفوري في المنظومة.',
    alreadyCta: 'الانتقال لتسجيل الدخول ←',
    expiredBadge: 'رابط منتهي الصلاحية',
    expiredTitle: 'انتهت صلاحية رابط التأكيد',
    expiredDesc: 'لأسباب أمنية مشددة، تنتهي صلاحية روابط التأكيد بعد مرور 24 ساعة. سجّل الدخول لإرسال رابط تأكيد جديد إلى بريدك.',
    expiredCta: 'طلب رابط جديد عبر صفحة الدخول ←',
    invalidBadge: 'رمز غير صالح',
    invalidTitle: 'رمز التأكيد غير صالح',
    invalidDesc: 'الرابط المستخدم غير صالح أو تم استخدامه مسبقًا. يرجى التأكد من فتح أحدث رسالة وصلتك من SENSOURA عبر بريدنا الرسمي.',
    invalidCta: 'العودة لصفحة الدخول ←',
    capabilities: [
      { icon: '📊', name: 'مراقبة لحظية' },
      { icon: '🤖', name: 'تنبؤات الذكاء الاصطناعي' },
      { icon: '🍃', name: 'تحليلات المحصول' },
      { icon: '🔔', name: 'تنبيهات ذكية' },
    ],
    footerTagline: 'SENSOURA · حيث يلتقي الذكاء بالزراعة',
    officialEmail: 'info@sensoura.ox0x.com',
  },
  en: {
    brandName: 'SENSOURA',
    brandSub: 'SMART AGRICULTURE INTELLIGENCE',
    accountVerification: 'ACCOUNT VERIFICATION',
    home: 'Home',
    login: 'Sign in',
    readyTitle: 'Verify your email address.',
    readyDesc: 'One final step to activate your SENSOURA account and start using your smart agriculture dashboard.',
    readyButton: 'COMPLETE VERIFICATION →',
    verifyingTitle: 'Verifying your email address…',
    verifyingDesc: 'Please wait while we validate your security token with Firebase Authentication.',
    successBadge: 'VERIFIED & ACTIVATED ✨',
    successTitle: 'Email Verified Successfully! ✨',
    successDesc: 'Welcome to the SENSOURA platform. Your email address has been cryptographically confirmed with Firebase Authentication. You can now sign in and access live greenhouse telemetry, autonomous irrigation controls, and AI diagnostics.',
    successCta: 'CONTINUE TO SIGN IN →',
    alreadyBadge: 'ALREADY VERIFIED',
    alreadyTitle: 'Email Already Verified',
    alreadyDesc: 'This email address was already verified previously and is ready to access your SENSOURA dashboard.',
    alreadyCta: 'PROCEED TO SIGN IN →',
    expiredBadge: 'LINK EXPIRED',
    expiredTitle: 'Verification Link Expired',
    expiredDesc: 'For security reasons, verification links expire after 24 hours. Sign in to your account to request a fresh verification link.',
    expiredCta: 'SIGN IN TO REQUEST NEW LINK →',
    invalidBadge: 'INVALID LINK',
    invalidTitle: 'Invalid Verification Link',
    invalidDesc: 'This verification link is invalid, malformed, or has already been used. Please check your inbox for the newest verification email from SENSOURA.',
    invalidCta: 'RETURN TO SIGN IN →',
    capabilities: [
      { icon: '📊', name: 'Real-time Monitoring' },
      { icon: '🤖', name: 'AI Predictions' },
      { icon: '🍃', name: 'Crop Insights' },
      { icon: '🔔', name: 'Smart Alerts' },
    ],
    footerTagline: 'SENSOURA · Intelligence meets agriculture',
    officialEmail: 'info@sensoura.ox0x.com',
  },
};

export function EmailVerification() {
  const [params] = useSearchParams();
  const { language, toggleLanguage } = useLanguage();
  const t = copy[language] || copy.en;
  const isRtl = language === 'ar';

  const [state, setState] = useState<VerificationState>('verifying');
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);

  const mode = params.get('mode');
  const oobCode = params.get('oobCode');

  useEffect(() => {
    let active = true;

    async function executeVerification() {
      // 1. Validate that this is an email verification request with an action code
      if (!oobCode || mode !== 'verifyEmail') {
        if (active) setState('invalid');
        return;
      }

      try {
        // 2. Cryptographically check the action code first
        try {
          const info = await checkFirebaseActionCode(oobCode);
          if (active && info.email) {
            setVerifiedEmail(info.email);
          }
        } catch {
          // If checkActionCode failed, applyActionCode will catch the exact error code
        }

        // 3. Apply the action code directly in Firebase Authentication
        await applyFirebaseActionCode(oobCode);

        if (active) {
          setState('success');
        }
      } catch (error: any) {
        if (!active) return;
        const errorCode = String(error?.code || error?.message || '');
        if (errorCode.includes('expired-action-code')) {
          setState('expired');
        } else if (errorCode.includes('invalid-action-code')) {
          setState('invalid');
        } else {
          setState('invalid');
        }
      }
    }

    void executeVerification();

    return () => {
      active = false;
    };
  }, [mode, oobCode]);

  const ArrowIcon = isRtl ? ArrowLeft : ArrowRight;

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className="min-h-screen relative flex flex-col justify-between overflow-x-hidden selection:bg-[#087B58] selection:text-white"
      style={{
        backgroundColor: '#051514',
        backgroundImage: 'radial-gradient(circle at 50% 10%, #0A2925 0%, #051514 80%)',
      }}
    >
      {/* BACKGROUND BOTANICAL ATMOSPHERE */}
      <div
        className="fixed inset-0 pointer-events-none opacity-40 z-0 bg-cover bg-center"
        style={{
          backgroundImage: 'url(/sensoura-auth-action-bg.jpg)',
        }}
      />
      <div className="fixed inset-0 pointer-events-none bg-gradient-to-b from-[#051514]/70 via-transparent to-[#051514]/90 z-0" />

      {/* TOP HEADER */}
      <header className="relative z-20 border-b border-[#133834]/80 bg-[#041413]/90 backdrop-blur-md px-4 sm:px-8 py-3.5 flex items-center justify-between shadow-lg">
        {/* Brand logo */}
        <Link to="/" className="flex items-center gap-3 group">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#087B58] to-[#56DCC8] flex items-center justify-center font-extrabold text-[#031410] text-lg shadow-lg shadow-[#087B58]/30 group-hover:scale-105 transition-transform">
            S
          </div>
          <div>
            <div className="text-sm font-black tracking-widest text-[#FFFFFF] leading-none">
              SENSOURA<span className="text-[10px] text-[#56DCC8] font-bold ml-1">®</span>
            </div>
            <div className="text-[9px] font-bold tracking-wider text-[#56DCC8] uppercase leading-tight mt-0.5">
              {t.brandSub}
            </div>
          </div>
        </Link>

        {/* Header Actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-[#56DCC8]/30 bg-[#56DCC8]/10 text-[10px] font-extrabold tracking-wider text-[#56DCC8] uppercase">
            <ShieldCheck className="w-3.5 h-3.5 text-[#56DCC8]" />
            <span>{t.accountVerification}</span>
          </span>
          <button
            type="button"
            onClick={toggleLanguage}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#133834] bg-[#081C1B]/80 hover:bg-[#0E2F2B] text-xs font-semibold text-[#56DCC8] transition-colors"
          >
            <Globe2 className="w-3.5 h-3.5" />
            <span>{language === 'ar' ? 'English' : 'العربية'}</span>
          </button>
          <ThemeToggle />
          <Link
            to="/login"
            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-[#9EBEB7] hover:text-[#FFFFFF] transition-colors"
          >
            {t.login}
          </Link>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-8 sm:py-16">
        <div className="w-full max-w-[560px] mx-auto">
          {/* MAIN WHITE/MINT CARD (Matching Reference Image) */}
          <div className="relative rounded-[28px] bg-[#F4FAF7]/95 dark:bg-[#F4FAF7]/95 backdrop-blur-xl border border-[#D5EBE3] shadow-2xl shadow-black/80 px-6 sm:px-10 py-8 sm:py-10 text-center transition-all">
            
            {/* CENTER FLOATING BADGE */}
            <div className="flex justify-center -mt-2 mb-4">
              <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-[#A1F2D2] to-[#56DCC8] p-1 shadow-lg shadow-[#087B58]/20 flex items-center justify-center">
                <div className="w-full h-full rounded-full bg-[#E8F8F2] flex items-center justify-center relative">
                  {state === 'verifying' ? (
                    <Loader2 className="w-10 h-10 text-[#087B58] animate-spin" />
                  ) : state === 'success' ? (
                    <div className="relative">
                      <CheckCircle2 className="w-10 h-10 text-[#087B58]" />
                      <Sparkles className="w-4 h-4 text-[#56DCC8] absolute -top-1 -right-1 animate-pulse" />
                    </div>
                  ) : state === 'already_verified' ? (
                    <CheckCircle2 className="w-10 h-10 text-[#087B58]" />
                  ) : state === 'expired' ? (
                    <AlertTriangle className="w-10 h-10 text-[#C98A0C]" />
                  ) : (
                    <Mail className="w-10 h-10 text-[#087B58]" />
                  )}
                </div>
              </div>
            </div>

            {/* HEADING */}
            <h1 className="text-2xl sm:text-3xl font-extrabold text-[#0C2620] tracking-tight">
              {state === 'verifying'
                ? t.verifyingTitle
                : state === 'success'
                ? t.successTitle
                : state === 'already_verified'
                ? t.alreadyTitle
                : state === 'expired'
                ? t.expiredTitle
                : t.invalidTitle}
            </h1>

            {/* SUPPORTING TEXT */}
            <p className="mt-3 text-sm sm:text-base text-[#36534C] leading-relaxed max-w-md mx-auto">
              {state === 'verifying'
                ? t.verifyingDesc
                : state === 'success'
                ? (verifiedEmail ? `${t.successDesc} (${verifiedEmail})` : t.successDesc)
                : state === 'already_verified'
                ? t.alreadyDesc
                : state === 'expired'
                ? t.expiredDesc
                : t.invalidDesc}
            </p>

            {/* INTERACTIVE CTA BUTTON */}
            <div className="mt-7">
              {state === 'verifying' ? (
                <div className="inline-flex items-center justify-center gap-2.5 px-8 py-3.5 rounded-xl bg-[#087B58]/80 text-white font-bold text-sm tracking-wide shadow-lg shadow-[#087B58]/30">
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>{t.verifyingTitle}</span>
                </div>
              ) : state === 'success' ? (
                <Link
                  to="/login"
                  className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl bg-gradient-to-r from-[#087B58] to-[#055C41] hover:from-[#0A946A] hover:to-[#087B58] text-white font-extrabold text-sm sm:text-base tracking-wider uppercase shadow-xl shadow-[#087B58]/40 hover:scale-[1.02] active:scale-[0.98] transition-all"
                >
                  <span>{t.successCta}</span>
                  <ArrowIcon className="w-4 h-4" />
                </Link>
              ) : state === 'already_verified' ? (
                <Link
                  to="/login"
                  className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl bg-gradient-to-r from-[#087B58] to-[#055C41] hover:from-[#0A946A] hover:to-[#087B58] text-white font-extrabold text-sm tracking-wider uppercase shadow-xl shadow-[#087B58]/40 hover:scale-[1.02] active:scale-[0.98] transition-all"
                >
                  <span>{t.alreadyCta}</span>
                  <ArrowIcon className="w-4 h-4" />
                </Link>
              ) : state === 'expired' ? (
                <Link
                  to="/login"
                  className="inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl bg-gradient-to-r from-[#087B58] to-[#055C41] text-white font-bold text-sm tracking-wide shadow-lg shadow-[#087B58]/30 hover:scale-[1.02] transition-all"
                >
                  <span>{t.expiredCta}</span>
                  <ArrowIcon className="w-4 h-4" />
                </Link>
              ) : (
                <Link
                  to="/login"
                  className="inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl bg-[#0C2620] hover:bg-[#133834] text-white font-bold text-sm tracking-wide shadow-lg hover:scale-[1.02] transition-all"
                >
                  <span>{t.invalidCta}</span>
                  <ArrowIcon className="w-4 h-4" />
                </Link>
              )}
            </div>

            {/* PLATFORM CAPABILITIES (Matching Reference Card) */}
            <div className="mt-8 pt-6 border-t border-[#D5EBE3]">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {t.capabilities.map((cap, idx) => (
                  <div
                    key={idx}
                    className="flex flex-col items-center justify-center p-2.5 rounded-xl bg-[#E6F5EE] border border-[#CDE8DC] text-center"
                  >
                    <span className="text-lg">{cap.icon}</span>
                    <span className="text-[11px] font-bold text-[#0F3D32] mt-1 leading-tight">
                      {cap.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      </main>

      {/* FOOTER */}
      <footer className="relative z-10 py-6 text-center text-xs text-[#9EBEB7] border-t border-[#133834]/60 bg-[#041413]/80 backdrop-blur-md">
        <div className="flex items-center justify-center gap-2 mb-1">
          <Leaf className="w-4 h-4 text-[#56DCC8]" />
          <span className="font-bold text-white tracking-wide">{t.footerTagline}</span>
        </div>
        <div className="text-[11px] text-[#6E8D85] mt-1">
          <a href={`mailto:${t.officialEmail}`} className="hover:text-[#56DCC8] transition-colors">
            ✉ {t.officialEmail}
          </a>
        </div>
      </footer>
    </div>
  );
}
