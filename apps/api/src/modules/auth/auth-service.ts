import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { AppError } from "../../errors.ts";
import type { MobileRepository } from "../../database/repositories/mobile-repository.ts";
import type { DriverProfile } from "@itms/types";

export interface AuthTokenPayload {
  sub: number; // driverId
  code: string; // driverCode
  email: string;
  role: "driver" | "admin" | "operator";
  exp: number; // timestamp ms
}

export class AuthService {
  private readonly mobileRepo: MobileRepository;
  private readonly secret: string;

  constructor(mobileRepo: MobileRepository, secret = "sistech-itms-emergency-auth-secret-key-2026") {
    this.mobileRepo = mobileRepo;
    this.secret = secret;
  }

  // -------------------------------------------------- PASSWORD HASHING ----
  hashPassword(password: string): string {
    const salt = randomBytes(16).toString("hex");
    const derivedKey = scryptSync(password, salt, 64).toString("hex");
    return `scrypt:${salt}:${derivedKey}`;
  }

  verifyPassword(password: string, storedHash: string): boolean {
    const parts = storedHash.split(":");
    if (parts.length !== 3) return false;
    const [algo, salt, expectedHash] = parts;
    if (algo === "scrypt" && salt && expectedHash) {
      const derivedKey = scryptSync(password, salt, 64).toString("hex");
      return timingSafeEqual(Buffer.from(derivedKey, "hex"), Buffer.from(expectedHash, "hex"));
    }
    if (algo === "sha256" && salt && expectedHash) {
      const hash = createHmac("sha256", salt).update(password).digest("hex");
      return timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(expectedHash, "hex"));
    }
    return false;
  }

  // ---------------------------------------------------- JWT TOKEN UTILS ----
  createToken(payload: Omit<AuthTokenPayload, "exp">, expiresInMs = 24 * 60 * 60 * 1000): string {
    const exp = Date.now() + expiresInMs;
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ ...payload, exp })).toString("base64url");
    const signature = createHmac("sha256", this.secret)
      .update(`${header}.${body}`)
      .digest("base64url");
    return `${header}.${body}.${signature}`;
  }

  verifyToken(token: string): AuthTokenPayload {
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new AppError(401, "invalid_token", "Malformed authentication token.");
    }
    const [header, body, signature] = parts;
    const expectedSig = createHmac("sha256", this.secret)
      .update(`${header}.${body}`)
      .digest("base64url");
    if (signature !== expectedSig) {
      throw new AppError(401, "invalid_token", "Invalid token signature.");
    }
    try {
      const payload = JSON.parse(Buffer.from(body!, "base64url").toString("utf8")) as AuthTokenPayload;
      if (Date.now() > payload.exp) {
        throw new AppError(401, "token_expired", "Authentication token has expired. Please login again.");
      }
      return payload;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(401, "invalid_token", "Could not parse token payload.");
    }
  }

  // ------------------------------------------------- LOGIN & REFRESH ----
  async login(
    email: string,
    password: string,
    ipAddress?: string,
  ): Promise<{
    token: string;
    refreshToken: string;
    driver: DriverProfile;
  }> {
    const driver = await this.mobileRepo.getDriverByEmail(email);
    if (!driver) {
      throw new AppError(401, "invalid_credentials", "Invalid driver email or password.");
    }

    const isValid = this.verifyPassword(password, driver.password_hash);
    if (!isValid) {
      await this.mobileRepo.recordAudit(
        "login_failed",
        driver.driver_code,
        driver.role,
        null,
        { reason: "invalid_password", email },
        ipAddress,
      );
      throw new AppError(401, "invalid_credentials", "Invalid driver email or password.");
    }

    // Auto-advance driver status to on_duty if available
    if (driver.status === "available" || driver.status === "off_duty") {
      await this.mobileRepo.updateDriverStatus(driver.id, "on_duty");
      driver.status = "on_duty";
    }

    const token = this.createToken({
      sub: driver.id,
      code: driver.driver_code,
      email: driver.email,
      role: driver.role,
    });

    const refreshToken = this.createToken(
      {
        sub: driver.id,
        code: driver.driver_code,
        email: driver.email,
        role: driver.role,
      },
      7 * 24 * 60 * 60 * 1000,
    );

    await this.mobileRepo.recordAudit(
      "login",
      driver.driver_code,
      driver.role,
      null,
      { email: driver.email },
      ipAddress,
    );

    const profile = await this.getDriverProfile(driver.id);
    return { token, refreshToken, driver: profile };
  }

  async refresh(refreshToken: string): Promise<{ token: string; refreshToken: string }> {
    const payload = this.verifyToken(refreshToken);
    const driver = await this.mobileRepo.getDriverById(payload.sub);
    if (!driver) {
      throw new AppError(401, "driver_not_found", "Driver account no longer exists.");
    }

    const token = this.createToken({
      sub: driver.id,
      code: driver.driver_code,
      email: driver.email,
      role: driver.role,
    });
    const newRefreshToken = this.createToken(
      {
        sub: driver.id,
        code: driver.driver_code,
        email: driver.email,
        role: driver.role,
      },
      7 * 24 * 60 * 60 * 1000,
    );
    return { token, refreshToken: newRefreshToken };
  }

  async logout(driverId: number, ipAddress?: string): Promise<void> {
    const driver = await this.mobileRepo.getDriverById(driverId);
    if (driver && driver.status !== "in_emergency") {
      await this.mobileRepo.updateDriverStatus(driverId, "available");
    }
    await this.mobileRepo.recordAudit(
      "logout",
      driver?.driver_code ?? String(driverId),
      driver?.role ?? "driver",
      null,
      {},
      ipAddress,
    );
  }

  async getDriverProfile(driverId: number): Promise<DriverProfile> {
    const driver = await this.mobileRepo.getDriverById(driverId);
    if (!driver) {
      throw new AppError(404, "driver_not_found", `Driver #${driverId} not found.`);
    }

    const assignedVehicle = await this.mobileRepo.getAssignedVehicleForDriver(driverId);

    return {
      id: driver.id,
      driverCode: driver.driver_code,
      name: driver.name,
      email: driver.email,
      phone: driver.phone,
      role: driver.role,
      status: driver.status,
      licenseNumber: driver.license_number,
      assignedVehicle,
      currentEmergencyId: assignedVehicle?.currentEmergencyId ?? null,
    };
  }

  // ------------------------------------------------ FASTIFY HELPERS ----
  extractBearerToken(request: FastifyRequest): string | null {
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      const query = request.query as Record<string, unknown>;
      if (query && typeof query.token === "string") {
        return query.token;
      }
      return null;
    }
    const parts = authHeader.split(" ");
    if (parts.length === 2 && parts[0]?.toLowerCase() === "bearer") {
      return parts[1] ?? null;
    }
    return null;
  }

  authenticate(request: FastifyRequest): AuthTokenPayload {
    const token = this.extractBearerToken(request);
    if (!token) {
      throw new AppError(401, "missing_token", "Authorization header with Bearer token is required.");
    }
    return this.verifyToken(token);
  }
}
