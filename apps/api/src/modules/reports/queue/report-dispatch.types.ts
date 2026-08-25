export const REPORT_DISPATCH_QUEUE = 'report-dispatch';

export const DAILY_REPORT_SCHEDULER_ID = 'daily-report-tick';
export const WEEKLY_REPORT_SCHEDULER_ID = 'weekly-report-tick';
export const RUN_DAILY_TICK_JOB = 'run-daily-tick';
export const RUN_WEEKLY_TICK_JOB = 'run-weekly-tick';

export interface ReportDispatchJobData {
  frequency: 'DAILY' | 'WEEKLY';
}
