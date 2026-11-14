import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getLogger } from '../utils/logger.js';
import { realtimeService } from '../services/realtime.js';
import { requireUserAuth } from '../services/auth.js';
import { evaluateCropRotationStrategies, CROPS_DATABASE } from '../ai/crop-rotation.js';
import type { FarmContext } from '../ai/crop-rotation.js';

const logger = getLogger('crop-rotation');

const farmContextSchema = z.object({
  soilType: z.enum(['clay', 'loam', 'sandy', 'clay_loam']).default('clay_loam'),
  primaryGoal: z.enum(['water_saving', 'soil_health', 'max_yield', 'climate_adaptation']).default('max_yield'),
  currentCropId: z.string().trim().min(1).max(64).optional(),
}).strict();

function formatLocationPayload(loc: ReturnType<typeof realtimeService.getLocation>) {
  const latitude = typeof loc?.latitude === 'number' ? loc.latitude : 30.044444;
  const longitude = typeof loc?.longitude === 'number' ? loc.longitude : 31.235833;
  const city = loc?.city || 'Cairo';
  const country = loc?.country || 'Egypt';
  return {
    name: `${city}, ${country}`,
    city,
    country,
    lat: latitude,
    lon: longitude,
    latitude,
    longitude,
  };
}

export async function registerCropRotationRoutes(fastify: FastifyInstance): Promise<void> {

  /**
   * GET /api/ai/crop-rotation
   * Evaluates and returns the 3 strategies based on current live telemetry.
   */
  fastify.get('/api/ai/crop-rotation', { preHandler: [requireUserAuth] }, async () => {
    const sensorData = realtimeService.getSensorData();
    const location = realtimeService.getLocation();

    const context: FarmContext = {
      soilType: 'clay_loam', // Default for Nile Delta region
      primaryGoal: 'max_yield',
      currentSoilMoisture: sensorData?.SoilMoisture,
      currentAirTemp: sensorData?.AirTemp,
      currentHumidity: sensorData?.AirHumidity,
    };

    const strategies = evaluateCropRotationStrategies(context);

    logger.info({
      strategiesCount: strategies.length,
      hasSensorData: !!sensorData,
      hasLocation: !!location,
    }, 'Crop rotation strategies evaluated');

    return {
      strategies,
      location: formatLocationPayload(location),
      availableCrops: Object.values(CROPS_DATABASE).map(c => ({
        id: c.id,
        nameEn: c.nameEn,
        nameAr: c.nameAr,
        category: c.category,
        growingSeason: c.growingSeason,
      })),
      evaluatedAt: Date.now(),
      source: 'SENSOURA AI + NASA Earth Observations',
    };
  });

  /**
   * POST /api/ai/crop-rotation/evaluate
   * Accepts custom FarmContext and returns tailored strategy evaluations.
   */
  fastify.post<{ Body: z.infer<typeof farmContextSchema> }>(
    '/api/ai/crop-rotation/evaluate',
    { preHandler: [requireUserAuth] },
    async (request, reply) => {
      const parsed = farmContextSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Invalid farm context',
          details: parsed.error.flatten(),
        });
      }

      const sensorData = realtimeService.getSensorData();
      const location = realtimeService.getLocation();

      const context: FarmContext = {
        ...parsed.data,
        currentSoilMoisture: sensorData?.SoilMoisture,
        currentAirTemp: sensorData?.AirTemp,
        currentHumidity: sensorData?.AirHumidity,
      };

      const strategies = evaluateCropRotationStrategies(context);

      logger.info({
        soilType: context.soilType,
        primaryGoal: context.primaryGoal,
        currentCropId: context.currentCropId,
        strategiesCount: strategies.length,
      }, 'Custom crop rotation evaluation');

      return {
        strategies,
        context: {
          soilType: context.soilType,
          primaryGoal: context.primaryGoal,
          currentCropId: context.currentCropId,
        },
        location: formatLocationPayload(location),
        availableCrops: Object.values(CROPS_DATABASE).map(c => ({
          id: c.id,
          nameEn: c.nameEn,
          nameAr: c.nameAr,
          category: c.category,
          growingSeason: c.growingSeason,
        })),
        evaluatedAt: Date.now(),
        source: 'SENSOURA AI + NASA Earth Observations',
      };
    },
  );
}

