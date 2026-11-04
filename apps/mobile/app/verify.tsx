import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  api,
  ApiError,
  type CaptureLayout,
  type DocumentType,
  type ImageSide,
  type PickedImage,
  type VerificationStatus,
} from '../src/api';
import { useTheme } from '../src/theme';
import { Button, Card, Loading, Screen, SectionTitle, Segmented } from '../src/ui';

const SIDES: Record<CaptureLayout, ImageSide[]> = {
  front_back: ['front', 'back'],
  single: ['single'],
};

const SIDE_LABEL: Record<ImageSide, string> = {
  front: 'Front',
  back: 'Back',
  single: 'One photo',
};

/**
 * ID check: the player photographs their national ID card or passport, front and back or in a
 * single frame, and our review team checks it. Vouchers need a verified adult, one per account.
 */
export default function VerifyScreen() {
  const status = useQuery({ queryKey: ['verification'], queryFn: api.verificationStatus });
  const [retrying, setRetrying] = useState(false);
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Verify your ID' }} />
      {status.isPending ? (
        <Loading />
      ) : (
        <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: 32 }}>
          {status.data && status.data.status !== 'unverified' && !retrying ? (
            <StatusCard status={status.data} onRetry={() => setRetrying(true)} />
          ) : (
            <UploadForm onSubmitted={() => setRetrying(false)} />
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

function StatusCard({ status, onRetry }: { status: VerificationStatus; onRetry: () => void }) {
  const t = useTheme();
  if (status.status === 'approved') {
    return (
      <Card>
        <Text style={[styles.heading, { color: t.accent }]}>Your ID is verified</Text>
        <Text style={[styles.body, { color: t.muted }]}>
          You can redeem vouchers with your won coins.
        </Text>
      </Card>
    );
  }
  if (status.status === 'pending') {
    return (
      <Card>
        <Text style={[styles.heading, { color: t.text }]}>We&apos;re checking your ID</Text>
        <Text style={[styles.body, { color: t.muted }]}>
          This usually takes less than a day. We&apos;ll unlock vouchers as soon as it&apos;s done.
        </Text>
        {status.submission ? (
          <Text style={[styles.small, { color: t.muted }]}>
            {status.submission.documentType === 'nid' ? 'National ID card' : 'Passport'}, sent{' '}
            {new Date(status.submission.submittedAt).toLocaleString()}
          </Text>
        ) : null}
      </Card>
    );
  }
  return (
    <Card>
      <Text style={[styles.heading, { color: t.live }]}>We couldn&apos;t verify your ID</Text>
      <Text style={[styles.body, { color: t.text }]}>
        {status.submission?.rejectionReason ?? 'The photos could not be checked.'}
      </Text>
      <Text style={[styles.body, { color: t.muted, marginBottom: 12 }]}>
        Send new photos: make sure the whole document is in frame, sharp and without glare.
      </Text>
      <Button label="Try again" onPress={onRetry} />
    </Card>
  );
}

function UploadForm({ onSubmitted }: { onSubmitted: () => void }) {
  const t = useTheme();
  const qc = useQueryClient();
  const [documentType, setDocumentType] = useState<DocumentType>('nid');
  const [layout, setLayout] = useState<CaptureLayout>('front_back');
  const [images, setImages] = useState<Partial<Record<ImageSide, PickedImage>>>({});
  const [birthDate, setBirthDate] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [pickError, setPickError] = useState<string | null>(null);

  const sides = SIDES[layout];
  const submit = useMutation({
    mutationFn: () =>
      api.submitIdDocuments({
        documentType,
        layout,
        birthDate: birthDate.trim(),
        documentNumber: documentNumber.trim(),
        images: Object.fromEntries(sides.map((s) => [s, images[s]])),
      }),
    onSuccess: async (status) => {
      qc.setQueryData(['verification'], status);
      onSubmitted();
      await qc.invalidateQueries();
    },
  });

  async function pick(side: ImageSide, source: 'camera' | 'library') {
    setPickError(null);
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      quality: 0.7,
      allowsEditing: false,
      exif: false,
    };
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setPickError('Allow camera access in Settings, or choose a photo from your gallery.');
        return;
      }
    }
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
    const asset = result.canceled ? undefined : result.assets[0];
    if (asset) {
      setImages((prev) => ({
        ...prev,
        [side]: { uri: asset.uri, mimeType: asset.mimeType, fileName: asset.fileName },
      }));
    }
  }

  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(birthDate.trim());
  const complete =
    validDate && documentNumber.trim().length >= 6 && sides.every((s) => images[s] !== undefined);
  const input = [
    styles.input,
    { color: t.text, borderColor: t.border, backgroundColor: t.surface },
  ];

  return (
    <>
      <Card>
        <Text style={[styles.body, { color: t.text, marginTop: 0 }]}>
          Vouchers are for players aged 18 and over, and each person can verify one account. Add
          photos of your national ID card or passport and our team will check them.
        </Text>
      </Card>

      <SectionTitle>Document</SectionTitle>
      <Segmented
        options={[
          { value: 'nid', label: 'National ID card' },
          { value: 'passport', label: 'Passport' },
        ]}
        value={documentType}
        onChange={setDocumentType}
      />

      <SectionTitle>Photos</SectionTitle>
      <Segmented
        options={[
          { value: 'front_back', label: 'Front and back' },
          { value: 'single', label: 'Single photo' },
        ]}
        value={layout}
        onChange={setLayout}
      />
      <Text style={[styles.hint, { color: t.muted }]}>
        {layout === 'single'
          ? 'Both sides in one photo, or the passport photo page.'
          : documentType === 'nid'
            ? 'One photo of each side of the card.'
            : 'The photo page, then the page with your address or signature.'}
      </Text>
      {sides.map((side) => (
        <PhotoSlot
          key={side}
          label={SIDE_LABEL[side]}
          image={images[side]}
          onPick={(source) => void pick(side, source)}
        />
      ))}
      {pickError ? <Text style={[styles.hint, { color: t.live }]}>{pickError}</Text> : null}

      <SectionTitle>Details</SectionTitle>
      <Card>
        <Text style={[styles.label, { color: t.muted, marginTop: 0 }]}>
          Date of birth (YYYY-MM-DD)
        </Text>
        <TextInput
          style={input}
          value={birthDate}
          onChangeText={setBirthDate}
          placeholder="1998-05-10"
          placeholderTextColor={t.muted}
          inputMode="numeric"
          autoComplete="birthdate-full"
        />
        <Text style={[styles.label, { color: t.muted }]}>
          {documentType === 'nid' ? 'National ID number' : 'Passport number'}
        </Text>
        <TextInput
          style={input}
          value={documentNumber}
          onChangeText={setDocumentNumber}
          placeholderTextColor={t.muted}
          autoCapitalize="characters"
          autoCorrect={false}
        />
        <Text style={[styles.small, { color: t.muted }]}>
          Your photos are encrypted, seen only by our review team, and deleted 90 days after the
          check. We keep your date of birth and a scrambled fingerprint of your ID number, never the
          number itself.
        </Text>
        {submit.error ? (
          <Text style={{ color: t.live, marginTop: 8 }}>
            {submit.error instanceof ApiError ? submit.error.message : 'Something went wrong.'}
          </Text>
        ) : null}
        <View style={{ marginTop: 12 }}>
          <Button
            label="Send for review"
            disabled={!complete}
            busy={submit.isPending}
            onPress={() => submit.mutate()}
          />
        </View>
      </Card>
    </>
  );
}

function PhotoSlot({
  label,
  image,
  onPick,
}: {
  label: string;
  image: PickedImage | undefined;
  onPick: (source: 'camera' | 'library') => void;
}) {
  const t = useTheme();
  return (
    <Card>
      <View style={styles.slotRow}>
        {image ? (
          <Image source={{ uri: image.uri }} style={styles.thumb} resizeMode="cover" />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Take photo: ${label}`}
            onPress={() => onPick('camera')}
            style={[styles.thumb, styles.emptyThumb, { borderColor: t.border }]}
          >
            <Text style={{ color: t.muted, fontSize: 28 }}>+</Text>
          </Pressable>
        )}
        <View style={{ flex: 1, gap: 8 }}>
          <Text style={[styles.slotTitle, { color: t.text }]}>
            {label} {image ? <Text style={{ color: t.accent }}>✓</Text> : null}
          </Text>
          <Button
            label={image ? 'Retake' : 'Take photo'}
            kind={image ? 'secondary' : 'primary'}
            onPress={() => onPick('camera')}
          />
          <Pressable accessibilityRole="button" onPress={() => onPick('library')} hitSlop={8}>
            <Text style={{ color: t.accent, fontWeight: '600', textAlign: 'center' }}>
              Choose from gallery
            </Text>
          </Pressable>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 17, fontWeight: '700' },
  body: { fontSize: 14, lineHeight: 20, marginTop: 6 },
  small: { fontSize: 12, lineHeight: 17, marginTop: 12 },
  hint: { fontSize: 13, marginHorizontal: 16, marginTop: -4, marginBottom: 12, lineHeight: 18 },
  label: { fontSize: 13, fontWeight: '600', marginTop: 16, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, minHeight: 44, fontSize: 16 },
  slotRow: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  slotTitle: { fontSize: 15, fontWeight: '700' },
  thumb: { width: 112, height: 72, borderRadius: 8 },
  emptyThumb: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
