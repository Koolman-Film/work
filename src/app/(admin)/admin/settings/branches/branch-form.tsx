import Link from 'next/link';
import { GeofencePicker } from '@/components/map/geofence-picker-dynamic';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input, Textarea } from '@/components/ui/input';

type Initial = {
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  requireSelfie: boolean;
};

type Mode =
  | { mode: 'create'; action: (formData: FormData) => Promise<void>; initial?: undefined }
  | { mode: 'edit'; action: (formData: FormData) => Promise<void>; initial: Initial };

type Props = Mode & {
  error?: string | null;
  /** Trailing slot for the Archive button on edit; null on create. */
  extraActions?: React.ReactNode;
};

export function BranchForm({ mode, action, initial, error, extraActions }: Props) {
  const submitLabel = mode === 'create' ? 'สร้างสาขา' : 'บันทึก';
  const initialRadius = initial?.radiusMeters ?? 150;

  return (
    <form action={action}>
      <Card>
        <CardHeader>
          <CardTitle>{mode === 'create' ? 'เพิ่มสาขาใหม่' : 'แก้ไขสาขา'}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-5">
          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <FormField label="ชื่อสาขา" htmlFor="name" required>
            <Input
              id="name"
              name="name"
              required
              maxLength={80}
              defaultValue={initial?.name ?? ''}
              autoFocus
            />
          </FormField>

          <FormField label="ที่อยู่" htmlFor="address" hint="ใช้สำหรับอ้างอิงเท่านั้น (ไม่บังคับ)">
            <Textarea
              id="address"
              name="address"
              rows={2}
              maxLength={500}
              defaultValue={initial?.address ?? ''}
            />
          </FormField>

          <FormField
            label="รัศมี Geofence (เมตร)"
            htmlFor="radiusMeters"
            hint="ระยะที่อนุญาตให้เช็คอินจากพิกัดสาขา (50–1000) — ใช้กับ LIFF check-in"
          >
            <Input
              id="radiusMeters"
              name="radiusMeters"
              type="number"
              min={50}
              max={1000}
              step={10}
              defaultValue={initialRadius}
              className="max-w-xs"
            />
          </FormField>

          <FormField
            label="ตำแหน่งบนแผนที่"
            htmlFor="latitude"
            hint="คลิกเพื่อปักหมุด หรือลากหมุดเพื่อปรับ — ไม่บังคับ (ถ้าไม่ตั้งค่า จะไม่บังคับ geofence)"
          >
            <GeofencePicker
              initialLat={initial?.latitude ?? null}
              initialLng={initial?.longitude ?? null}
              initialRadiusMeters={initialRadius}
              latInputName="latitude"
              lngInputName="longitude"
            />
          </FormField>

          <div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                name="requireSelfie"
                defaultChecked={initial?.requireSelfie ?? false}
                className="size-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500/30"
              />
              <span>ต้องถ่ายเซลฟี่ตอนเช็คอิน</span>
            </label>
            <p className="ml-6 mt-0.5 text-xs text-gray-500">
              เพิ่มความน่าเชื่อถือ — ป้องกันการให้คนอื่นเช็คอินแทน
            </p>
          </div>
        </CardBody>
        <CardFooter className="flex items-center justify-between">
          <Link href="/admin/settings/branches">
            <Button type="button" variant="secondary">
              ยกเลิก
            </Button>
          </Link>
          <div className="flex gap-2">
            {extraActions}
            <Button type="submit">{submitLabel}</Button>
          </div>
        </CardFooter>
      </Card>
    </form>
  );
}
