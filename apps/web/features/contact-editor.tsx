'use client';
import { useState } from 'react';
import {
  Alert,
  Button,
  Group,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { contactSchema, type ContactData } from '@fileforge/shared';
import { IconCheck, IconDeviceFloppy } from '@tabler/icons-react';
import { errorMessage } from '../lib/api';
const textFields = [
  ['fullName', 'Full name'],
  ['firstName', 'First name'],
  ['lastName', 'Last name'],
  ['jobTitle', 'Job title'],
  ['company', 'Company'],
  ['department', 'Department'],
  ['address', 'Postal address'],
  ['city', 'City'],
  ['state', 'State / region'],
  ['country', 'Country'],
  ['postalCode', 'Postal code'],
] as const;
export function ContactEditor({
  initialData,
  onSave,
  onCancel,
}: {
  initialData?: Partial<ContactData>;
  onSave: (data: ContactData, status: 'draft' | 'approved') => Promise<void>;
  onCancel?: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const form = useForm({
    initialValues: {
      ...(Object.fromEntries(textFields.map(([key]) => [key, initialData?.[key] || ''])) as Record<
        (typeof textFields)[number][0],
        string
      >),
      emails: initialData?.emails?.map((e) => e.email).join('\n') || '',
      phones: initialData?.phones?.map((e) => e.number).join('\n') || '',
      websites: initialData?.websites?.join('\n') || '',
      socialLinks: initialData?.socialLinks?.map((e) => e.url).join('\n') || '',
      notes: initialData?.notes || '',
    },
  });
  async function save(status: 'draft' | 'approved') {
    if (pending) return;
    setError('');
    const v = form.values;
    const lines = (value: string) =>
      value
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean);
    const parsed = contactSchema.safeParse({
      ...Object.fromEntries(textFields.map(([key]) => [key, v[key].trim() || null])),
      notes: v.notes.trim() || null,
      emails: lines(v.emails).map((email) => ({
        email,
        label: initialData?.emails?.find((e) => e.email === email)?.label || null,
      })),
      phones: lines(v.phones).map((number) => ({
        number,
        label: initialData?.phones?.find((p) => p.number === number)?.label || null,
      })),
      websites: lines(v.websites),
      socialLinks: lines(v.socialLinks).map((url) => ({
        url,
        label: initialData?.socialLinks?.find((l) => l.url === url)?.label || null,
      })),
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      return;
    }
    if (
      status === 'approved' &&
      !parsed.data.fullName &&
      !parsed.data.company &&
      !parsed.data.emails.length
    ) {
      setError('Add a name, company, or email before approving this contact.');
      return;
    }
    setPending(true);
    try {
      await onSave(parsed.data, status);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <Stack gap="lg">
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        {textFields.map(([key, label]) => (
          <TextInput
            key={key}
            label={label}
            {...form.getInputProps(key)}
            style={key === 'address' || key === 'fullName' ? { gridColumn: '1 / -1' } : undefined}
          />
        ))}
      </SimpleGrid>
      <Title order={5}>Contact details</Title>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Textarea
          label="Email addresses"
          description="One address per line"
          minRows={2}
          {...form.getInputProps('emails')}
        />
        <Textarea
          label="Phone numbers"
          description="One number per line"
          minRows={2}
          {...form.getInputProps('phones')}
        />
        <Textarea
          label="Websites"
          description="One full URL per line, including https://"
          minRows={2}
          {...form.getInputProps('websites')}
        />
        <Textarea
          label="Social links"
          description="One full URL per line, including https://"
          minRows={2}
          {...form.getInputProps('socialLinks')}
        />
      </SimpleGrid>
      <Textarea label="Additional notes" minRows={3} {...form.getInputProps('notes')} />
      {error && (
        <Alert color="red" title="Check the contact details">
          {error}
        </Alert>
      )}
      <Text size="xs" c="dimmed">
        Review all fields against the original card. Only approve information you have checked.
      </Text>
      <Group justify="space-between" pt="md" style={{ borderTop: '1px solid var(--ff-border)' }}>
        {onCancel ? (
          <Button variant="default" onClick={onCancel}>
            Cancel
          </Button>
        ) : (
          <Button
            variant="default"
            leftSection={<IconDeviceFloppy size={16} />}
            loading={pending}
            onClick={() => void save('draft')}
          >
            Save draft
          </Button>
        )}
        <Button
          leftSection={<IconCheck size={16} />}
          loading={pending}
          onClick={() => void save('approved')}
        >
          Approve & save contact
        </Button>
      </Group>
    </Stack>
  );
}
