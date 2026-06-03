"use server";

import { createSession, deleteSession } from "@/lib/session";
import { redirect } from "next/navigation";

export async function login(
  _prevState: { error?: string } | null,
  formData: FormData
): Promise<{ error: string }> {
  const password = formData.get("password") as string;
  const expected = process.env.AUTH_PASSWORD;

  if (!expected) {
    return { error: "AUTH_PASSWORD not configured on server" };
  }

  if (!password || password !== expected) {
    return { error: "Invalid password" };
  }

  await createSession();
  redirect("/");
}

export async function logout() {
  await deleteSession();
  redirect("/login");
}
