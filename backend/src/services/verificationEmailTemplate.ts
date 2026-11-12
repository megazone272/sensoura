import type { EmailData, EmailLanguage } from './email.js';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

const BRAND = {
  bgDark: '#061514',
  cardDark: '#081C1B',
  headerDark: '#041413',
  borderDark: '#133834',
  emerald: '#087B58',
  emeraldHover: '#0A946A',
  mint: '#56DCC8',
  white: '#FFFFFF',
  textMuted: '#9EBEB7',
  cardMintBg: '#F4FAF7',
  cardMintBorder: '#D5EBE3',
  cardHeading: '#0C2620',
  cardBody: '#36534C',
  noticeText: '#507168',
  noticeMuted: '#6E8D85',
};

const labels = {
  ar: {
    dir: 'rtl',
    lang: 'ar',
    brandName: 'SENSOURA',
    brandSub: 'أنظمة الزراعة الذكية والمراقبة الفضائية',
    accountServices: 'خدمات الحساب',
    welcomePill: 'WELCOME ABOARD ✨',
    heroHeadlinePart1: 'مستقبل الزراعة الذكية يبدأ بـ ',
    heroHeadlinePart2: 'نقرة واحدة.',
    heroSub: 'رحلتك في المراقبة اللحظية والتحكم المستقل بالبيوت الزراعية أوشكت على الانطلاق.',
    cardHeading: 'تأكيد البريد الإلكتروني.',
    cardSub: 'خطوة أخيرة لتفعيل حسابك في SENSOURA بأمان والوصول إلى لوحة المراقبة الحية للحساسات والذكاء الاصطناعي.',
    buttonText: 'تأكيد البريد الإلكتروني ←',
    capabilities: [
      { icon: '📊', name: 'مراقبة لحظية' },
      { icon: '🤖', name: 'تنبؤات الذكاء الاصطناعي' },
      { icon: '🍃', name: 'تحليلات المحصول' },
      { icon: '🔔', name: 'تنبيهات ذكية' },
    ],
    expiryText1: 'ينتهي رابط التأكيد هذا خلال ',
    expiryHighlight: '24 ساعة.',
    safetyText: 'لم تنشئ حسابًا؟ يمكنك تجاهل هذا البريد الإلكتروني بأمان.',
    fallbackPrompt: 'تواجه مشكلة في الزر؟ ',
    fallbackLinkText: 'انقر هنا لتأكيد بريدك',
    footerHeadline: 'نبتكر للغد · زراعة مستدامة بلا حدود 🌱',
    footerSub: 'SENSOURA · حيث يلتقي الذكاء بالزراعة',
    officialEmail: 'info@sensoura.ox0x.com',
    subject: 'أكّد بريدك الإلكتروني | SENSOURA',
  },
  en: {
    dir: 'ltr',
    lang: 'en',
    brandName: 'SENSOURA',
    brandSub: 'SMART AGRICULTURE INTELLIGENCE',
    accountServices: 'ACCOUNT SERVICES',
    welcomePill: 'WELCOME ABOARD ✨',
    heroHeadlinePart1: 'A smarter future starts with ',
    heroHeadlinePart2: 'one click.',
    heroSub: 'Your journey into intelligent agriculture is almost ready.',
    cardHeading: 'Verify your email address.',
    cardSub: 'Confirm your email to securely activate your SENSOURA account and access your smart agriculture dashboard.',
    buttonText: 'VERIFY EMAIL ADDRESS →',
    capabilities: [
      { icon: '📊', name: 'Real-time Monitoring' },
      { icon: '🤖', name: 'AI Predictions' },
      { icon: '🍃', name: 'Crop Insights' },
      { icon: '🔔', name: 'Smart Alerts' },
    ],
    expiryText1: 'This verification link will expire in ',
    expiryHighlight: '24 hours.',
    safetyText: "Didn't create an account? You can safely ignore this email.",
    fallbackPrompt: 'Trouble with the button? ',
    fallbackLinkText: 'Click here to verify directly',
    footerHeadline: 'Grow beyond limits. 🌱',
    footerSub: 'SENSOURA · Intelligence meets agriculture.',
    officialEmail: 'info@sensoura.ox0x.com',
    subject: 'Verify your email | SENSOURA',
  },
};

export function renderPremiumVerificationEmail(
  language: EmailLanguage,
  data: EmailData
): { subject: string; html: string; text: string } {
  const l = labels[language] || labels.en;
  const verificationLink = data.verificationLink?.trim();
  if (!verificationLink) {
    throw new Error('Verification link is required');
  }

  const safeLink = escapeHtml(verificationLink);
  const isRtl = l.dir === 'rtl';

  const rawName = data.name?.trim() || (language === 'ar' ? 'صديقنا المزارع' : 'Grower');
  const safeName = escapeHtml(rawName);

  const baseUrl = (data.assetBaseUrl?.trim() || 'https://sensoura.ox0x.com').replace(/\/+$/, '');
  const plantImgUrl = `${baseUrl}/sensoura-email-plant.jpg`;
  const landscapeImgUrl = `${baseUrl}/sensoura-email-landscape.jpg`;
  const badgeImgUrl = `${baseUrl}/sensoura-email-badge.png`;

  const html = `<!DOCTYPE html>
<html lang="${l.lang}" dir="${l.dir}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${escapeHtml(l.subject)}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style type="text/css">
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; display: block; }
    body { margin: 0; padding: 0; width: 100% !important; background-color: ${BRAND.bgDark}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    .btn-cta:hover { background-color: ${BRAND.emeraldHover} !important; }
    @media only screen and (max-width: 620px) {
      .email-container { width: 100% !important; max-width: 100% !important; border-radius: 0 !important; }
      .hero-cell { display: block !important; width: 100% !important; text-align: center !important; }
      .hero-text { text-align: center !important; padding: 24px 20px 10px 20px !important; }
      .hero-img-wrap { padding: 10px 20px 24px 20px !important; }
      .card-wrap { padding: 24px 16px !important; margin: 4px 12px 16px 12px !important; border-radius: 18px !important; }
      .cap-cell { display: inline-block !important; width: 46% !important; margin: 4px !important; }
      .btn-cta { width: 100% !important; box-sizing: border-box !important; text-align: center !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: ${BRAND.bgDark}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: ${BRAND.white};">
  <!-- PREHEADER -->
  <div style="display: none; font-size: 1px; color: ${BRAND.bgDark}; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden; mso-hide: all;">
    Verify Email · ${safeName} · ${escapeHtml(l.heroHeadlinePart1)}${escapeHtml(l.heroHeadlinePart2)} · ${escapeHtml(l.heroSub)}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: ${BRAND.bgDark};">
    <tr>
      <td align="center" style="padding: 20px 8px 36px 8px;">
        <!-- MAIN CONTAINER (600px MAX) -->
        <table role="presentation" class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; width: 100%; background-color: ${BRAND.cardDark}; border-radius: 24px; border: 1px solid ${BRAND.borderDark}; overflow: hidden; box-shadow: 0 25px 60px rgba(0, 0, 0, 0.55);">
          
          <!-- A. HEADER BAR -->
          <tr>
            <td style="padding: 22px 28px; background-color: ${BRAND.headerDark}; border-bottom: 1px solid ${BRAND.borderDark};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <!-- Brand logo & name -->
                  <td align="${isRtl ? 'right' : 'left'}" style="vertical-align: middle;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="vertical-align: middle;">
                          <div style="width: 36px; height: 36px; border-radius: 10px; background: linear-gradient(135deg, ${BRAND.emerald} 0%, ${BRAND.mint} 100%); text-align: center; line-height: 36px; font-size: 18px; font-weight: 900; color: #031410;">
                            S
                          </div>
                        </td>
                        <td style="padding-${isRtl ? 'right' : 'left'}: 12px; vertical-align: middle;">
                          <div style="font-size: 17px; font-weight: 800; letter-spacing: 2px; color: ${BRAND.white}; line-height: 1.2;">
                            ${escapeHtml(l.brandName)}<span style="font-size: 11px; vertical-align: super; font-weight: 700; color: ${BRAND.mint}; margin-left: 2px;">®</span>
                          </div>
                          <div style="font-size: 9px; font-weight: 700; letter-spacing: 1.5px; color: ${BRAND.mint}; text-transform: uppercase; line-height: 1.2; margin-top: 3px;">
                            ${escapeHtml(l.brandSub)}
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <!-- Account services badge -->
                  <td align="${isRtl ? 'left' : 'right'}" style="vertical-align: middle;">
                    <span style="display: inline-block; padding: 5px 12px; font-size: 10px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; color: ${BRAND.mint}; background-color: rgba(86, 220, 200, 0.08); border: 1px solid rgba(86, 220, 200, 0.3); border-radius: 20px;">
                      🛡️ ${escapeHtml(l.accountServices)}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- B. HERO SECTION -->
          <tr>
            <td style="padding: 0; background: linear-gradient(180deg, ${BRAND.headerDark} 0%, ${BRAND.cardDark} 100%);">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <!-- Left: Welcome pill & headline -->
                  <td class="hero-cell hero-text" width="56%" align="${isRtl ? 'right' : 'left'}" style="padding: 28px 24px 20px 28px; vertical-align: middle;">
                    <!-- Welcome Pill -->
                    <div style="display: inline-block; padding: 4px 12px; background-color: rgba(8, 123, 88, 0.25); border: 1px solid ${BRAND.emerald}; border-radius: 16px; font-size: 10px; font-weight: 800; color: ${BRAND.mint}; letter-spacing: 1px;">
                      ${escapeHtml(l.welcomePill)}
                    </div>
                    <!-- Headline -->
                    <h1 style="margin: 14px 0 0 0; font-size: 26px; font-weight: 800; line-height: 1.25; color: ${BRAND.white}; letter-spacing: -0.4px;">
                      ${escapeHtml(l.heroHeadlinePart1)}<span style="color: ${BRAND.mint};">${escapeHtml(l.heroHeadlinePart2)}</span>
                    </h1>
                    <!-- Subtitle -->
                    <p style="margin: 10px 0 0 0; font-size: 13px; line-height: 1.55; color: ${BRAND.textMuted}; font-weight: 400;">
                      ${escapeHtml(l.heroSub)}
                    </p>
                  </td>
                  <!-- Right: Botanical plant scene with HUD overlay -->
                  <td class="hero-cell hero-img-wrap" width="44%" align="center" style="padding: 20px 24px 20px 10px; vertical-align: middle;">
                    <img src="${plantImgUrl}" alt="SENSOURA Botanical Intelligence" width="230" style="width: 100%; max-width: 230px; height: auto; border-radius: 14px; border: 1px solid rgba(86, 220, 200, 0.25); display: block; box-shadow: 0 12px 28px rgba(0, 0, 0, 0.5);" />
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- C. MAIN VERIFICATION CARD -->
          <tr>
            <td style="padding: 6px 18px 20px 18px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="card-wrap" style="background-color: ${BRAND.cardMintBg}; border: 1px solid ${BRAND.cardMintBorder}; border-radius: 22px; padding: 32px 28px 24px 28px; box-shadow: 0 15px 35px rgba(0, 0, 0, 0.15);">
                
                <!-- Floating Email Badge -->
                <tr>
                  <td align="center" style="padding-bottom: 14px;">
                    <img src="${badgeImgUrl}" alt="Email Verification" width="64" height="64" style="width: 64px; height: 64px; display: block; margin: 0 auto;" />
                  </td>
                </tr>

                <!-- Heading -->
                <tr>
                  <td align="center">
                    <h2 style="margin: 0; font-size: 22px; font-weight: 800; line-height: 1.3; color: ${BRAND.cardHeading}; letter-spacing: -0.3px;">
                      ${escapeHtml(l.cardHeading)}
                    </h2>
                  </td>
                </tr>

                <!-- Supporting Text -->
                <tr>
                  <td align="center" style="padding-top: 10px; padding-bottom: 22px;">
                    <p style="margin: 0 auto; max-width: 440px; font-size: 13px; line-height: 1.55; color: ${BRAND.cardBody}; font-weight: 400;">
                      ${escapeHtml(l.cardSub)}
                    </p>
                  </td>
                </tr>

                <!-- Large Emerald CTA Button -->
                <tr>
                  <td align="center" style="padding-bottom: 24px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto;">
                      <tr>
                        <td align="center" bgcolor="${BRAND.emerald}" style="border-radius: 12px; background: linear-gradient(135deg, ${BRAND.emerald} 0%, #055C41 100%); box-shadow: 0 8px 22px rgba(8, 123, 88, 0.35);">
                          <!--[if mso]>
                          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeLink}" style="height:48px;v-text-anchor:middle;width:280px;" arcsize="25%" stroke="f" fillcolor="${BRAND.emerald}">
                            <w:anchorlock/>
                            <center style="color:#ffffff;font-family:sans-serif;font-size:14px;font-weight:bold;letter-spacing:0.8px;">
                              ${escapeHtml(l.buttonText)}
                            </center>
                          </v:roundrect>
                          <![endif]-->
                          <a href="${safeLink}" target="_blank" class="btn-cta" style="mso-hide:all; display: inline-block; padding: 15px 36px; font-size: 14px; font-weight: 800; letter-spacing: 0.8px; color: ${BRAND.white}; text-decoration: none; border-radius: 12px; text-transform: uppercase;">
                            ${escapeHtml(l.buttonText)}
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- D. PLATFORM CAPABILITIES ROW -->
                <tr>
                  <td align="center" style="padding-bottom: 20px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        ${l.capabilities.map((cap) => `
                        <td class="cap-cell" align="center" style="padding: 6px 4px;">
                          <div style="background-color: #E6F5EE; border: 1px solid #CDE8DC; border-radius: 10px; padding: 8px 6px; text-align: center;">
                            <span style="font-size: 14px; display: block; margin-bottom: 2px;">${cap.icon}</span>
                            <span style="font-size: 10px; font-weight: 700; color: #0F3D32; line-height: 1.2; display: block;">${escapeHtml(cap.name)}</span>
                          </div>
                        </td>`).join('')}
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Divider -->
                <tr>
                  <td style="padding-bottom: 16px;">
                    <div style="height: 1px; background-color: ${BRAND.cardMintBorder}; line-height: 1px;"></div>
                  </td>
                </tr>

                <!-- E. EXPIRY & SECURITY NOTICES -->
                <tr>
                  <td align="center">
                    <p style="margin: 0; font-size: 12px; line-height: 1.5; color: ${BRAND.noticeText}; font-weight: 500;">
                      ⓘ ${escapeHtml(l.expiryText1)}<strong style="color: ${BRAND.emerald}; font-weight: 700;">${escapeHtml(l.expiryHighlight)}</strong>
                    </p>
                    <p style="margin: 6px 0 0 0; font-size: 11px; line-height: 1.5; color: ${BRAND.noticeMuted};">
                      ${escapeHtml(l.safetyText)}
                    </p>
                    <p style="margin: 14px 0 0 0; font-size: 10px; line-height: 1.4; color: #8BA8A1; word-break: break-all;">
                      ${escapeHtml(l.fallbackPrompt)}<a href="${safeLink}" target="_blank" style="color: ${BRAND.emerald}; text-decoration: underline; font-weight: 600;">${escapeHtml(l.fallbackLinkText)}</a>
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- F. FOOTER LANDSCAPE & BRANDING -->
          <tr>
            <td style="padding: 0; background-color: ${BRAND.cardDark};">
              <!-- Agricultural rolling hills landscape -->
              <img src="${landscapeImgUrl}" alt="SENSOURA Agriculture Fields" width="600" style="width: 100%; max-width: 600px; height: auto; display: block;" />
              
              <!-- Footer text -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="padding: 20px 24px 28px 24px; background-color: #041413;">
                <tr>
                  <td align="center">
                    <div style="font-size: 13px; font-weight: 800; color: ${BRAND.white}; letter-spacing: 0.5px;">
                      ${escapeHtml(l.footerHeadline)}
                    </div>
                    <div style="font-size: 11px; font-weight: 600; color: ${BRAND.mint}; margin-top: 4px; letter-spacing: 0.5px;">
                      ${escapeHtml(l.footerSub)}
                    </div>
                    <div style="margin-top: 8px;">
                      <a href="mailto:${escapeHtml(l.officialEmail)}" style="font-size: 11px; color: ${BRAND.textMuted}; text-decoration: none; font-weight: 500;">
                        ✉ ${escapeHtml(l.officialEmail)}
                      </a>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `${l.brandName} - ${l.brandSub}
${'='.repeat(40)}

Verify Email: ${safeName}

${l.heroHeadlinePart1}${l.heroHeadlinePart2}
${l.heroSub}

${l.cardHeading}
${l.cardSub}

${l.buttonText}:
${verificationLink}

${l.expiryText1}${l.expiryHighlight}
${l.safetyText}

${l.footerHeadline}
${l.footerSub}
${l.officialEmail}
`;

  return {
    subject: l.subject,
    html,
    text,
  };
}
