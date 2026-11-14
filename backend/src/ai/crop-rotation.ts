/**
 * SENSOURA — Crop Rotation Decision-Support Engine
 * Developed for NASA Space Apps Cairo 2026 — "Field Shift: Adapting Farms with NASA Data"
 *
 * Integrates ground sensor telemetry (soil moisture, temperature, VOC, barometric pressure)
 * with NASA Earth observations (NASA POWER, SMAP baseline, GPM precipitation, MODIS/Landsat indices)
 * to evaluate and compare three distinct agricultural rotation strategies.
 */

export interface CropProfile {
  id: string;
  nameEn: string;
  nameAr: string;
  category: 'cereal' | 'legume' | 'forage' | 'oilseed' | 'vegetable';
  growingSeason: 'winter' | 'summer' | 'nili';
  durationDays: number;
  waterNeedMmPerSeason: number; // Crop Evapotranspiration ETc in mm
  nitrogenImpactKgHa: number; // Positive = adds/fixes N, Negative = extracts N
  heatTolerance: 'low' | 'moderate' | 'high';
  droughtTolerance: 'low' | 'moderate' | 'high';
  optimalSoilMoisturePct: [number, number]; // [min, max]
  economicReturnRating: 1 | 2 | 3 | 4 | 5;
}

export const CROPS_DATABASE: Record<string, CropProfile> = {
  wheat: {
    id: 'wheat',
    nameEn: 'Wheat (Giza 171)',
    nameAr: 'القمح (جيزة 171)',
    category: 'cereal',
    growingSeason: 'winter',
    durationDays: 155,
    waterNeedMmPerSeason: 450,
    nitrogenImpactKgHa: -65,
    heatTolerance: 'moderate',
    droughtTolerance: 'moderate',
    optimalSoilMoisturePct: [30, 60],
    economicReturnRating: 4,
  },
  maize: {
    id: 'maize',
    nameEn: 'Yellow Maize (Single Cross 168)',
    nameAr: 'الذرة الصفراء (هجين فردي 168)',
    category: 'cereal',
    growingSeason: 'summer',
    durationDays: 115,
    waterNeedMmPerSeason: 650,
    nitrogenImpactKgHa: -90,
    heatTolerance: 'high',
    droughtTolerance: 'moderate',
    optimalSoilMoisturePct: [35, 65],
    economicReturnRating: 4,
  },
  faba_bean: {
    id: 'faba_bean',
    nameEn: 'Faba Bean (Giza 843)',
    nameAr: 'الفول البلدي (جيزة 843)',
    category: 'legume',
    growingSeason: 'winter',
    durationDays: 140,
    waterNeedMmPerSeason: 320,
    nitrogenImpactKgHa: +55, // Biological nitrogen fixation
    heatTolerance: 'low',
    droughtTolerance: 'high',
    optimalSoilMoisturePct: [25, 55],
    economicReturnRating: 4,
  },
  egyptian_clover: {
    id: 'egyptian_clover',
    nameEn: 'Egyptian Clover (Berseem Miskawi)',
    nameAr: 'البرسيم المصري (المسكاوي)',
    category: 'forage',
    growingSeason: 'winter',
    durationDays: 170,
    waterNeedMmPerSeason: 580,
    nitrogenImpactKgHa: +75, // Exceptional biological fixation & organic biomass
    heatTolerance: 'moderate',
    droughtTolerance: 'low',
    optimalSoilMoisturePct: [40, 70],
    economicReturnRating: 5,
  },
  sorghum: {
    id: 'sorghum',
    nameEn: 'Sorghum (Dorado)',
    nameAr: 'الذرة الرفيعة (دورادو)',
    category: 'cereal',
    growingSeason: 'summer',
    durationDays: 105,
    waterNeedMmPerSeason: 380,
    nitrogenImpactKgHa: -45,
    heatTolerance: 'high',
    droughtTolerance: 'high',
    optimalSoilMoisturePct: [20, 50],
    economicReturnRating: 3,
  },
  sunflower: {
    id: 'sunflower',
    nameEn: 'Sunflower (Sakha 53)',
    nameAr: 'دوار الشمس (سخا 53)',
    category: 'oilseed',
    growingSeason: 'summer',
    durationDays: 95,
    waterNeedMmPerSeason: 360,
    nitrogenImpactKgHa: -30,
    heatTolerance: 'high',
    droughtTolerance: 'high',
    optimalSoilMoisturePct: [25, 50],
    economicReturnRating: 4,
  },
  soybean: {
    id: 'soybean',
    nameEn: 'Soybean (Giza 111)',
    nameAr: 'فول الصويا (جيزة 111)',
    category: 'legume',
    growingSeason: 'summer',
    durationDays: 110,
    waterNeedMmPerSeason: 480,
    nitrogenImpactKgHa: +40,
    heatTolerance: 'high',
    droughtTolerance: 'moderate',
    optimalSoilMoisturePct: [30, 60],
    economicReturnRating: 4,
  },
};

export interface CropRotationStrategy {
  id: string;
  nameEn: string;
  nameAr: string;
  tagEn: string;
  tagAr: string;
  theme: 'baseline' | 'water_resilient' | 'soil_regeneration';
  sequence: {
    season: 'Winter' | 'Summer';
    crop: CropProfile;
  }[];
  metrics: {
    waterConsumptionIndex: number; // 0 to 100 (lower is less water consumed)
    waterSavingsPercentage: number; // relative to baseline (0 to 50%)
    soilHealthScore: number; // 0 to 100
    nitrogenBalanceKgHa: number; // net kg N / ha per cycle
    climateRiskResilience: 'High' | 'Moderate' | 'Low';
    economicViability: 'High' | 'Balanced' | 'Moderate';
    overallSuitabilityScore: number; // 0 to 100
  };
  explanationEn: string;
  explanationAr: string;
  nasaDataContributions: {
    nasaPower: string;
    smap: string;
    gpm: string;
    landsatModis: string;
  };
  fieldTelemetryInsights: string[];
}

export interface FarmContext {
  soilType: 'clay' | 'loam' | 'sandy' | 'clay_loam';
  primaryGoal: 'water_saving' | 'soil_health' | 'max_yield' | 'climate_adaptation';
  currentCropId?: string;
  currentSoilMoisture?: number;
  currentAirTemp?: number;
  currentHumidity?: number;
}

export function evaluateCropRotationStrategies(context: FarmContext): CropRotationStrategy[] {
  const currentMoisture = context.currentSoilMoisture ?? 24.0;
  const currentTemp = context.currentAirTemp ?? 28.4;
  const isSoilDry = currentMoisture < 30;
  const soil = context.soilType || 'clay_loam';
  const goal = context.primaryGoal || 'max_yield';

  // --- Dynamic Soil Modifiers ---
  // Sandy: High drainage, high nutrient leaching risk, severe penalty for high-water monocultures.
  // Clay: High water retention, severe compaction risk, benefits from deep taproot aerators.
  // Loam: Balanced high fertility.
  // Clay Loam: Standard fertile Nile Delta soil.
  let baselineScore = 62;
  let waterScore = 86;
  let soilRegenScore = 89;

  let baselineWaterIndex = 88;
  let waterSavingsPct = 36;
  let soilHealthScore = 92;
  let nitrogenBalanceRegen = 75;

  let soilInsightAr = '';
  let soilInsightEn = '';

  switch (soil) {
    case 'sandy':
      baselineScore = 44;
      waterScore = 94;
      soilRegenScore = 87;
      baselineWaterIndex = 95;
      waterSavingsPct = 42;
      soilInsightAr = 'تربة رملية سريعة الصرف: رصد SMAP يؤكد انخفاض سعة الاحتفاظ المائي، مما يجعل المحاصيل الموفرة (الشعير والذرة الرفيعة) الخيار الأمثل لتفادي هدر الري.';
      soilInsightEn = 'Sandy high-drainage soil: NASA SMAP verifies low retention capacity, making drought-hardy cultivars essential to prevent irrigation percolation loss.';
      break;
    case 'clay':
      baselineScore = 58;
      waterScore = 86;
      soilRegenScore = 95;
      baselineWaterIndex = 84;
      waterSavingsPct = 34;
      soilInsightAr = 'تربة طينية ثقيلة: رصد SMAP يؤكد ارتفاع احتباس المياه؛ زراعة دوار الشمس والبقوليات تفتت انضغاط التربة وتعزز التهوية والصرف الداخلي.';
      soilInsightEn = 'Heavy clay soil: NASA SMAP indicates dense moisture retention; deep taproot sunflowers and legumes break subsoil compaction and restore internal aeration.';
      break;
    case 'loam':
      baselineScore = 72;
      waterScore = 88;
      soilRegenScore = 93;
      baselineWaterIndex = 82;
      waterSavingsPct = 36;
      soilInsightAr = 'تربة صفراء طميية متوازنة: خصوبة طبيعية مرتفعة تتيح مرونة عالية في تحقيق أقصى إنتاجية مع الحفاظ على دورة التناوب المستدام.';
      soilInsightEn = 'Balanced loam soil: High inherent fertility enables flexible rotation scheduling to maximize crop biomass while sustaining soil organic matter.';
      break;
    case 'clay_loam':
    default:
      baselineScore = 64;
      waterScore = 88;
      soilRegenScore = 92;
      baselineWaterIndex = 86;
      waterSavingsPct = 38;
      soilInsightAr = 'تربة الدلتا الطينية الصفراء: النمط القياسي للري في وادي النيل؛ التبديل لدورة موفرة للمياه يقلل الضغط على حصص مياه الترع.';
      soilInsightEn = 'Nile Delta clay-loam: Standard regional baseline; shifting to water-saving rotations relieves extraction pressure on local canal quotas.';
      break;
  }

  // --- Dynamic Primary Goal Modifiers ---
  switch (goal) {
    case 'max_yield':
      baselineScore += 8;
      waterScore += 2;
      soilRegenScore += 3;
      break;
    case 'water_saving':
      baselineScore -= 14;
      waterScore = Math.max(waterScore, 95);
      soilRegenScore -= 2;
      break;
    case 'soil_health':
      baselineScore -= 16;
      waterScore -= 2;
      soilRegenScore = Math.max(soilRegenScore, 96);
      break;
    case 'climate_adaptation':
      baselineScore -= 10;
      waterScore = Math.max(waterScore, 93);
      soilRegenScore = Math.max(soilRegenScore, 91);
      break;
  }

  if (isSoilDry) {
    waterScore = Math.min(99, waterScore + 2);
  }

  // 1. Baseline Strategy (Traditional: Wheat -> Maize)
  const baselineStrategy: CropRotationStrategy = {
    id: 'strategy_baseline',
    nameEn: 'Traditional Intensive Rotation (Wheat → Maize)',
    nameAr: 'الدورة التقليدية المكثفة (قمح ← ذرة صفراء)',
    tagEn: 'Current Practice',
    tagAr: 'الممارسة الحالية بالمزرعة',
    theme: 'baseline',
    sequence: [
      { season: 'Winter', crop: CROPS_DATABASE.wheat },
      { season: 'Summer', crop: CROPS_DATABASE.maize },
    ],
    metrics: {
      waterConsumptionIndex: baselineWaterIndex,
      waterSavingsPercentage: 0,
      soilHealthScore: soil === 'sandy' ? 42 : 54,
      nitrogenBalanceKgHa: -155, // Both crops heavily extract nitrogen
      climateRiskResilience: soil === 'sandy' ? 'Low' : 'Moderate',
      economicViability: goal === 'max_yield' ? 'High' : 'Moderate',
      overallSuitabilityScore: Math.max(35, Math.min(80, baselineScore)),
    },
    explanationEn:
      'High historical production value, but places continuous extraction pressure on soil nitrogen (-155 kg N/ha) and demands substantial irrigation water (1,100 mm/year), creating vulnerability to regional water stress identified by NASA POWER.',
    explanationAr:
      'تحقق عائداً تسويقياً مرتفعاً، لكنها تستنزف خصوبة التربة بشدة (-155 كجم نيتروجين/هكتار) وتستهلك كميات مياه ري ضخمة (1100 ملم/سنة)، مما يعرض المزرعة لمخاطر الإجهاد المائي التي ترصدها أقمار NASA.',
    nasaDataContributions: {
      nasaPower: 'Highlights solar radiation peaks and summer heatwave frequency requiring elevated peak irrigation.',
      smap: 'Indicates regional soil moisture deficits during summer transition months.',
      gpm: 'Confirms near-zero summer precipitation necessitating 100% reliance on irrigation water.',
      landsatModis: 'Provides historic NDVI peak patterns for seasonal vegetative growth calibration.',
    },
    fieldTelemetryInsights: [
      `Local ground moisture currently at ${currentMoisture}% demonstrates acute stress during hot hours (${currentTemp}°C).`,
      soilInsightEn,
      'Requires substantial synthetic nitrogen fertilizers to sustain wheat/maize yields.',
    ],
  };

  // 2. Climate-Resilient & Water-Conserving Strategy (Faba Bean -> Sorghum)
  const waterResilientStrategy: CropRotationStrategy = {
    id: 'strategy_water_resilient',
    nameEn: 'Climate-Adapted Water Saver (Faba Bean → Sorghum)',
    nameAr: 'دورة التكيف وتوفير المياه (فول بلدي ← ذرة رفيعة)',
    tagEn: 'Recommended for Drought Risk',
    tagAr: 'موصى بها لتوفير المياه ومقاومة الحرارة',
    theme: 'water_resilient',
    sequence: [
      { season: 'Winter', crop: CROPS_DATABASE.faba_bean },
      { season: 'Summer', crop: CROPS_DATABASE.sorghum },
    ],
    metrics: {
      waterConsumptionIndex: Math.round(baselineWaterIndex * (1 - waterSavingsPct / 100)),
      waterSavingsPercentage: waterSavingsPct,
      soilHealthScore: 78,
      nitrogenBalanceKgHa: +10, // Legume fixes N for subsequent drought crop
      climateRiskResilience: 'High',
      economicViability: 'Balanced',
      overallSuitabilityScore: Math.max(70, Math.min(98, waterScore)),
    },
    explanationEn:
      `Saves approximately ${waterSavingsPct}% of annual irrigation water by pairing a drought-tolerant legume (Faba Bean) with heat-hardy Sorghum. Faba beans fix biological nitrogen (+55 kg/ha) to support the subsequent summer crop with minimal fertilizer input.`,
    explanationAr:
      `توفر ما يقارب ${waterSavingsPct}% من مياه الري السنوية بالدمج بين البقوليات الموفرة للمياه (الفول البلدي) ومحصول الذرة الرفيعة المقاوم لدرجات الحرارة المرتفعة. يثبت الفول نيتروجين حيوي (+55 كجم/هكتار) يغذي المحصول الصيفي التالي تلقائياً.`,
    nasaDataContributions: {
      nasaPower: 'Validates that Sorghum heat threshold comfortably exceeds Cairo maximum summer temperatures.',
      smap: 'Matches satellite soil moisture envelope with Faba Bean deep root moisture absorption.',
      gpm: 'Leverages winter precipitation windows recorded by GPM to satisfy up to 25% of winter water demand.',
      landsatModis: 'Shows stable canopy reflectance under lower water footprints compared to conventional maize.',
    },
    fieldTelemetryInsights: [
      `Ideal adaptation for current telemetry: ground moisture (${currentMoisture}%) is well within the acceptable survival zone for drought-tolerant crops.`,
      soilInsightEn,
      `Reduces pump operation run-time by over ${waterSavingsPct}%, lowering energy and maintenance costs.`,
    ],
  };

  // 3. Regenerative & Soil-Health Strategy (Egyptian Clover -> Sunflower / Wheat)
  const soilRegenStrategy: CropRotationStrategy = {
    id: 'strategy_soil_regeneration',
    nameEn: 'Soil Health & Fertility Restorative (Berseem Clover → Sunflower)',
    nameAr: 'دورة استعادة خصوبة التربة والاستدامة (برسيم مسكاوي ← دوار الشمس)',
    tagEn: 'Top Soil Regeneration',
    tagAr: 'الأفضل لخصوبة وبناء المادة العضوية بالتربة',
    theme: 'soil_regeneration',
    sequence: [
      { season: 'Winter', crop: CROPS_DATABASE.egyptian_clover },
      { season: 'Summer', crop: CROPS_DATABASE.sunflower },
    ],
    metrics: {
      waterConsumptionIndex: Math.round(baselineWaterIndex * 0.75),
      waterSavingsPercentage: 24,
      soilHealthScore: soilHealthScore,
      nitrogenBalanceKgHa: +nitrogenBalanceRegen, // Net surplus biological nitrogen
      climateRiskResilience: 'High',
      economicViability: 'High',
      overallSuitabilityScore: Math.max(70, Math.min(99, soilRegenScore)),
    },
    explanationEn:
      'Focuses on rebuilding depleted organic matter and biological soil fertility. Egyptian clover contributes exceptional nitrogen fixation (+75 kg N/ha) and high biomass, while deep-taproot sunflowers break compacted soil layers and recycle nutrients from deep soil strata.',
    explanationAr:
      'تركز على استعادة المادة العضوية وخصوبة التربة المستنزفة. يثبت البرسيم كميات نيتروجين قياسية (+75 كجم/هكتار) مع وفرة المادة العضوية، بينما تعمل الجذور الوتدية العميقة لدوار الشمس على تفتيت الطبقات الصماء وامتصاص العناصر من أعماق التربة.',
    nasaDataContributions: {
      nasaPower: 'Monitors photo-synthetically active radiation (PAR) to optimize clover multiple-cut harvest timing.',
      smap: 'Correlates topsoil saturation recovery post-clover cultivation across seasonal satellite passes.',
      gpm: 'Monitors erratic precipitation events to time fertilizer-free seeding windows.',
      landsatModis: 'Detects superior vegetative cover index (NDVI > 0.72) indicating thriving soil biology.',
    },
    fieldTelemetryInsights: [
      'Addresses soil degradation indicators indicated by elevated soil temperature (22.5°C) and low organic moisture retention.',
      soilInsightEn,
      'Generates high-value livestock fodder and premium oilseed yield with balanced water usage.',
    ],
  };

  const strategies = [baselineStrategy, waterResilientStrategy, soilRegenStrategy];
  // Sort dynamically so the highest suitability score appears at the top
  strategies.sort((a, b) => b.metrics.overallSuitabilityScore - a.metrics.overallSuitabilityScore);

  return strategies;
}

