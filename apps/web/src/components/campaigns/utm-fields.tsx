'use client';

import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from '@linkiq/ui';
import type { Control, FieldValues, Path } from 'react-hook-form';

interface UtmFieldsProps<T extends FieldValues> {
  control: Control<T>;
  /** When set, each field's placeholder shows what it would inherit if
   * left blank — makes "inherited vs overridden" visually obvious
   * without any extra UI chrome. */
  inheritedDefaults?: {
    utmSource?: string | null;
    utmMedium?: string | null;
    utmCampaign?: string | null;
    utmTerm?: string | null;
    utmContent?: string | null;
  };
}

/** Shared UTM parameter fields — used identically in campaign creation
 * (defining defaults) and link creation (overriding them). Keeping this
 * as one component is what "Clearly show users which UTM values are
 * inherited and which are overridden" (Sprint 5 spec) actually means in
 * practice: the same placeholder-shows-the-default treatment in both
 * places, not two different UIs to learn. */
export function UtmFields<T extends FieldValues>({
  control,
  inheritedDefaults,
}: UtmFieldsProps<T>) {
  const fields: {
    name: Path<T>;
    label: string;
    example: string;
    inherited?: string | null;
  }[] = [
    {
      name: 'utmSource' as Path<T>,
      label: 'Source',
      example: 'facebook, newsletter, google',
      inherited: inheritedDefaults?.utmSource,
    },
    {
      name: 'utmMedium' as Path<T>,
      label: 'Medium',
      example: 'social, email, cpc',
      inherited: inheritedDefaults?.utmMedium,
    },
    {
      name: 'utmCampaign' as Path<T>,
      label: 'Campaign',
      example: 'summer_sale_2026',
      inherited: inheritedDefaults?.utmCampaign,
    },
    {
      name: 'utmTerm' as Path<T>,
      label: 'Term',
      example: 'running shoes',
      inherited: inheritedDefaults?.utmTerm,
    },
    {
      name: 'utmContent' as Path<T>,
      label: 'Content',
      example: 'header_cta',
      inherited: inheritedDefaults?.utmContent,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {fields.map((field) => (
        <FormField
          key={field.name}
          control={control}
          name={field.name}
          render={({ field: formField }) => (
            <FormItem>
              <FormLabel>
                {field.label}
                {field.inherited && (
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    (inherits &ldquo;{field.inherited}&rdquo;)
                  </span>
                )}
              </FormLabel>
              <FormControl>
                <Input
                  placeholder={field.inherited ?? field.example}
                  {...formField}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ))}
    </div>
  );
}
