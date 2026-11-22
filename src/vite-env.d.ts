/// <reference types="vite/client" />

/** Pont fourni par l'APK admin (Android) quand le tableau de bord s'y affiche ; absent dans un navigateur. */
interface PagioAdminBridge {
  hasNotifyKey(): boolean;
  setNotifyKey(token: string, adminEmail: string): void;
  deviceName(): string;
}
interface Window { PagioAdmin?: PagioAdminBridge }
