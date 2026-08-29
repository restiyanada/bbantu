import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { functionErrorMessage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label, RequiredMark } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const permissionFields = [
  { key: "canVerifyPayments", label: "Verify payments" },
  { key: "canScanConfirmPickup", label: "Scan / confirm pickup" },
  { key: "canManageProductsBatches", label: "Manage products & batches" },
  { key: "canAdjustInventory", label: "Adjust inventory" },
  { key: "canManageShipping", label: "Manage shipping" },
  { key: "canViewAuditLog", label: "View audit log" },
] as const;

const inviteSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  email: z.string().trim().email("A valid email is required."),
  canVerifyPayments: z.boolean(),
  canScanConfirmPickup: z.boolean(),
  canManageProductsBatches: z.boolean(),
  canAdjustInventory: z.boolean(),
  canManageShipping: z.boolean(),
  canViewAuditLog: z.boolean(),
});
type InviteValues = z.infer<typeof inviteSchema>;

export function InviteAdminDialog() {
  const [open, setOpen] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      name: "",
      email: "",
      canVerifyPayments: false,
      canScanConfirmPickup: false,
      canManageProductsBatches: false,
      canAdjustInventory: false,
      canManageShipping: false,
      canViewAuditLog: false,
    },
  });

  async function onSubmit(values: InviteValues) {
    const { name, email, ...permissions } = values;
    const { data, error } = await supabase.functions.invoke("invite-admin", {
      body: { name, email, permissions },
    });
    if (error) {
      toast.error(functionErrorMessage(error, "Couldn't invite this teammate."));
      return;
    }
    if (data?.inviteSent === false) {
      toast.warning(
        'Added as admin, but the invite email couldn\'t be sent — they can use "Forgot password" on the login page instead.'
      );
    } else {
      toast.success("Invite sent.");
    }
    reset();
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="w-full justify-start">
          <UserPlus className="size-4" />
          Invite teammate
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite teammate</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="invite-name">
              Name
              <RequiredMark />
            </Label>
            <Input id="invite-name" {...register("name")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">
              Work email
              <RequiredMark />
            </Label>
            <Input id="invite-email" type="email" {...register("email")} />
          </div>
          <div className="space-y-2">
            <Label>Permissions</Label>
            {permissionFields.map((field) => (
              <label key={field.key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4" {...register(field.key)} />
                {field.label}
              </label>
            ))}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Inviting…" : "Send invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
