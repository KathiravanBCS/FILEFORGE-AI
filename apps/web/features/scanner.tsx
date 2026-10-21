'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconArrowRight,
  IconCheck,
  IconCloudUpload,
  IconPhoto,
  IconScan,
  IconShieldLock,
  IconTrash,
  IconInfoCircle,
} from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import { uploadBusinessCard } from '../lib/uploads';
import { MAX_UPLOAD_BYTES, ALLOWED_IMAGE_TYPES } from '@fileforge/shared';
import { PageHeader } from '../components/page-parts';
interface LocalImage {
  file: File;
  url: string;
}
export function ScannerPage() {
  const [images, setImages] = useState<LocalImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [batch, setBatch] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const qc = useQueryClient();
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach(URL.revokeObjectURL), []);
  function add(files: FileList | File[] | null) {
    if (!files) return;
    setError('');
    const selected = Array.from(files);
    const max = batch ? 20 : 2;
    if (images.length + selected.length > max) {
      setError(
        batch
          ? 'Upload up to 20 individual cards per batch.'
          : 'Add up to two images: the front and back of one card.',
      );
      return;
    }
    for (const file of selected) {
      if (
        !ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number]) ||
        file.size > MAX_UPLOAD_BYTES
      ) {
        setError('Use JPG, PNG, or WebP images, up to 20 MB each.');
        return;
      }
    }
    const next = selected.map((file) => {
      const url = URL.createObjectURL(file);
      urls.current.push(url);
      return { file, url };
    });
    setImages((prev) => [...prev, ...next]);
  }
  function remove(index: number) {
    setImages((prev) => {
      const image = prev[index];
      if (image) URL.revokeObjectURL(image.url);
      return prev.filter((_, i) => i !== index);
    });
  }
  async function scan() {
    setBusy(true);
    setError('');
    try {
      const ids: string[] = [];
      for (let i = 0; i < images.length; i++) {
        setStatus(`Uploading image ${i + 1} of ${images.length}…`);
        const file = await uploadBusinessCard(images[i]!.file);
        ids.push(file.id);
      }
      const groups = batch ? ids.map((id) => [id]) : [ids];
      const submitted: string[] = [];
      for (let i = 0; i < groups.length; i++) {
        setStatus(`Queuing scan ${i + 1} of ${groups.length}…`);
        const result = await api<{ id: string }>('/scans', {
          method: 'POST',
          body: JSON.stringify({ fileIds: groups[i] }),
        });
        submitted.push(result.id);
      }
      await qc.invalidateQueries();
      notifications.show({
        title: submitted.length > 1 ? `${submitted.length} scans queued` : 'Scan queued',
        message: 'We’ll show the extracted details when processing finishes.',
        color: 'blue',
      });
      router.push(submitted.length === 1 ? `/scans/${submitted[0]}` : '/scans');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setStatus('');
    }
  }
  return (
    <>
      <PageHeader
        title="Business card scanner"
        description="Turn the cards you collect into connections you keep."
        action={
          <Button component={Link} href="/scans" variant="default">
            View scan history
          </Button>
        }
      />
      <div className="steps">
        <div className="step current">
          <span>1</span>Upload your card
        </div>
        <IconArrowRight size={13} color="var(--ff-text-muted)" />
        <div className="step">
          <span>2</span>AI extraction
        </div>
        <IconArrowRight size={13} color="var(--ff-text-muted)" />
        <div className="step">
          <span>3</span>Review & save
        </div>
      </div>
      <div className="scanner-grid">
        <div className="ff-panel">
          <Group justify="space-between" mb={22}>
            <div>
              <Title order={4}>Upload business cards</Title>
              <Text size="xs" c="dimmed" mt={6}>
                {batch
                  ? 'Each image creates a separate scan.'
                  : 'Add the front, and optionally the back, of one card.'}
              </Text>
            </div>
            <Badge variant="light" size="sm">
              JPG · PNG · WebP
            </Badge>
          </Group>
          <Group gap={8} mb={20}>
            <Button
              size="xs"
              variant={!batch ? 'light' : 'subtle'}
              onClick={() => {
                setBatch(false);
                if (images.length > 2) setImages(images.slice(0, 2));
              }}
            >
              One card, front & back
            </Button>
            <Button size="xs" variant={batch ? 'light' : 'subtle'} onClick={() => setBatch(true)}>
              Batch of cards
            </Button>
          </Group>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            aria-label="Choose business card images"
            style={{ display: 'none' }}
            onChange={(e) => {
              add(e.currentTarget.files);
              e.currentTarget.value = '';
            }}
          />
          <div
            className="drop-area"
            role="button"
            tabIndex={0}
            aria-label="Upload business card images"
            onClick={() => input.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                input.current?.click();
              }
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              add(e.dataTransfer.files);
            }}
          >
            <ThemeIcon size={58} variant="light" radius="xl" mb={15}>
              <IconCloudUpload size={29} stroke={1.4} />
            </ThemeIcon>
            <Text fw={600} size="sm">
              Drop your cards here, or{' '}
              <span style={{ color: 'var(--mantine-primary-color-filled)' }}>browse files</span>
            </Text>
            <Text size="xs" c="dimmed" mt={9}>
              JPG, PNG, or WebP · Up to 20 MB per image
            </Text>
            <Text size="10px" c="dimmed" mt={5}>
              {batch ? 'Up to 20 individual cards' : 'Up to 2 images per card'}
            </Text>
          </div>
          {images.length > 0 && (
            <SimpleGrid cols={{ base: 1, sm: 2 }} mt={20}>
              {images.map((image, i) => (
                <div key={image.url}>
                  <img
                    className="upload-preview"
                    src={image.url}
                    alt={`${batch ? 'Card' : i === 0 ? 'Front of card' : 'Back of card'} ${i + 1}`}
                  />
                  <Group justify="space-between" mt={7}>
                    <div>
                      <Text size="xs" fw={550} lineClamp={1} maw={170}>
                        {image.file.name}
                      </Text>
                      <Text size="10px" c="dimmed">
                        {(image.file.size / 1024 / 1024).toFixed(2)} MB ·{' '}
                        {batch ? `Card ${i + 1}` : i === 0 ? 'Front' : 'Back'}
                      </Text>
                    </div>
                    <ActionIcon
                      color="red"
                      variant="subtle"
                      aria-label={`Remove ${image.file.name}`}
                      disabled={busy}
                      onClick={() => remove(i)}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                </div>
              ))}
            </SimpleGrid>
          )}
          {error && (
            <Alert color="red" mt={20} title="Unable to start scan">
              {error}
            </Alert>
          )}
          <Group
            justify="space-between"
            mt={24}
            pt={20}
            style={{ borderTop: '1px solid var(--ff-border)' }}
          >
            <Text size="xs" c="dimmed">
              {busy
                ? status
                : `${images.length} ${images.length === 1 ? 'image' : 'images'} selected`}
            </Text>
            <Button
              onClick={() => void scan()}
              disabled={!images.length}
              loading={busy}
              leftSection={<IconScan size={17} />}
            >
              {batch && images.length > 1 ? `Scan ${images.length} cards` : 'Scan business card'}
            </Button>
          </Group>
        </div>
        <Stack gap={20}>
          <div className="ff-panel">
            <ThemeIcon variant="light" color="teal" size={39} mb={17}>
              <IconPhoto size={22} />
            </ThemeIcon>
            <Title order={4}>A good photo makes a difference.</Title>
            <Stack gap={15} mt={20}>
              {[
                'Place your card on a plain background.',
                'Use good lighting and avoid reflections.',
                'Keep all four corners in the frame.',
                'Upload the back for any extra details.',
              ].map((text) => (
                <Group key={text} align="flex-start" wrap="nowrap" gap={10}>
                  <IconCheck
                    size={16}
                    color="var(--mantine-color-teal-6)"
                    style={{ flexShrink: 0, marginTop: 2 }}
                  />
                  <Text size="sm" c="dimmed" lh={1.6}>
                    {text}
                  </Text>
                </Group>
              ))}
            </Stack>
          </div>
          <Alert
            icon={<IconInfoCircle size={18} />}
            color="blue"
            variant="light"
            title="You’re the final check"
          >
            AI extraction may miss or misread details. You’ll be able to review and edit everything
            before approving a contact.
          </Alert>
          <Group px={10} gap={9}>
            <IconShieldLock size={17} color="var(--ff-text-muted)" />
            <Text size="xs" c="dimmed">
              Images are stored in your private workspace.
            </Text>
          </Group>
        </Stack>
      </div>
    </>
  );
}
