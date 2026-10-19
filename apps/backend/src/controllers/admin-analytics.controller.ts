import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AnalyticsService } from '../services/analytics/analytics.service.js';
import { BadRequestError } from '../utils/errors.js';

const dateRangeQuerySchema = z.object({
  startDate: z
    .string()
    .optional()
    .refine((val) => !val || !Number.isNaN(Date.parse(val)), {
      message: 'Invalid startDate format, must be an ISO 8601 date string',
    }),
  endDate: z
    .string()
    .optional()
    .refine((val) => !val || !Number.isNaN(Date.parse(val)), {
      message: 'Invalid endDate format, must be an ISO 8601 date string',
    }),
});

export class AdminAnalyticsController {
  private static parseAndValidateDates(query: unknown): { startDate: Date; endDate: Date } {
    const parseResult = dateRangeQuerySchema.safeParse(query);
    if (!parseResult.success) {
      throw new BadRequestError(parseResult.error.errors[0]?.message || 'Invalid date query parameters');
    }

    const now = new Date();
    const defaultStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const startDate = parseResult.data.startDate
      ? new Date(parseResult.data.startDate)
      : defaultStart;
    const endDate = parseResult.data.endDate
      ? new Date(parseResult.data.endDate)
      : now;

    if (startDate > endDate) {
      throw new BadRequestError('startDate must be before or equal to endDate');
    }

    const maxRangeMs = 90 * 24 * 60 * 60 * 1000; // 90 days ceiling to avoid unbounded aggregation
    if (endDate.getTime() - startDate.getTime() > maxRangeMs) {
      throw new BadRequestError('Date range cannot exceed 90 days');
    }

    return { startDate, endDate };
  }

  public static async getOverview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { startDate, endDate } = AdminAnalyticsController.parseAndValidateDates(req.query);
      const data = await AnalyticsService.getOverview(startDate, endDate);
      res.status(200).json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  }

  public static async getTrends(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { startDate, endDate } = AdminAnalyticsController.parseAndValidateDates(req.query);
      const data = await AnalyticsService.getTrends(startDate, endDate);
      res.status(200).json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  }

  public static async getIngestionStats(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await AnalyticsService.getIngestionStats();
      res.status(200).json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  }
}
