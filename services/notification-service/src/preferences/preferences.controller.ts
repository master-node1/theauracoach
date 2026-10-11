import { Controller, Get, HttpStatus } from '@nestjs/common';
import { CurrentUser, ProblemException, type AuthenticatedUser } from '@aura/service-kit';
import { PrismaService } from '../prisma.service';

/** `NotificationPreferences` in docs/api/openapi.yaml. */
export interface NotificationPreferencesResponse {
  quietHoursStart: string;
  quietHoursEnd: string;
  workoutReminder: boolean;
  workoutReminderMinutesBefore: number;
  mealReminders: boolean;
  mealReminderSlots: string[];
  weeklySummary: boolean;
  inactivityNudges: number;
}

@Controller('v1/me/notification-preferences')
export class PreferencesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get(@CurrentUser() user: AuthenticatedUser): Promise<NotificationPreferencesResponse> {
    const prefs = await this.prisma.notificationPreference.findUnique({
      where: { userId: user.userId },
    });
    // Created from UserRegistered; until that event arrives the account is still being set up.
    if (!prefs)
      throw new ProblemException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Preferences not found');
    return {
      quietHoursStart: prefs.quietHoursStart,
      quietHoursEnd: prefs.quietHoursEnd,
      workoutReminder: prefs.workoutReminder,
      workoutReminderMinutesBefore: prefs.workoutReminderMinutesBefore,
      mealReminders: prefs.mealReminders,
      mealReminderSlots: prefs.mealReminderSlots,
      weeklySummary: prefs.weeklySummary,
      inactivityNudges: prefs.inactivityNudges,
    };
  }
}
