export type VehicleClassTier = 'Executive 11' | 'Standard 14' | 'VIP Coach 33';

export type TripStatus = 'Scheduled' | 'Boarding' | 'Departed' | 'Arrived' | 'Cancelled';

export type PaymentStatus = 'Pending' | 'Paid' | 'Failed' | 'Refunded';

export type BookingStatus = 'PendingPayment' | 'Confirmed' | 'Boarded' | 'Cancelled';

export type ParcelStatus = 'Booked' | 'In Transit' | 'Ready for Pickup' | 'Collected' | 'Cancelled';

export interface Sacco {
  id: string;
  name: string;
  code: string;
  headquarters: string;
  ntsaLicense: string;
  mpesaPaybill: string;
  supportPhone: string;
  rating: number;
  fleetCount: number;
}

export interface Vehicle {
  id: string;
  saccoId: string;
  plateNumber: string;
  model: string;
  capacity: number;
  classTier: VehicleClassTier;
  ntsaExpiry: string;
  speedGovernorStatus: 'Calibrated 80km/h' | 'Inspection Due' | 'Suspended';
  driverName: string;
  status: 'Active' | 'Maintenance' | 'Grounded';
}

export interface Trip {
  id: string;
  saccoId: string;
  saccoName: string;
  vehicleId: string;
  plateNumber: string;
  classTier: VehicleClassTier;
  origin: string;
  originStage: string;
  destination: string;
  destinationStage: string;
  departureDate: string;
  departureTime: string;
  arrivalTime: string;
  durationLabel: string;
  fareKes: number;
  capacity: number;
  availableSeats: number;
  bookedSeats: string[];
  status: TripStatus;
}

export interface Booking {
  id: string;
  ticketRef: string;
  tripId: string;
  passengerUid: string;
  passengerName: string;
  passengerPhone: string;
  pickupStage: string;
  dropoffStage: string;
  saccoName: string;
  plateNumber: string;
  routeLabel: string;
  departureDate: string;
  departureTime: string;
  seats: string[];
  totalKes: number;
  mpesaReceipt: string;
  checkoutRequestId: string;
  paymentStatus: PaymentStatus;
  status: BookingStatus;
  qrSignature: string;
  createdAt?: unknown;
}

export interface Parcel {
  id: string;
  waybillNo: string;
  senderUid: string;
  senderName: string;
  senderPhone: string;
  recipientName: string;
  recipientPhone: string;
  originCity: string;
  destinationCity: string;
  saccoName: string;
  description: string;
  weightKg: number;
  feeKes: number;
  mpesaReceipt: string;
  status: ParcelStatus;
  createdAt?: unknown;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  phone?: string;
  preferredStage?: string;
  role: 'passenger' | 'operator' | 'admin';
}

export interface CorridorInfo {
  id: string;
  origin: string;
  destination: string;
  distanceKm: number;
  durationLabel: string;
  baseFareKes: number;
  expresswayTollKes: number;
  pickupStages: string[];
  dropoffStages: string[];
  highway: string;
  highlights: string;
}

export interface RouteQuote {
  origin: string;
  destination: string;
  classTier: VehicleClassTier;
  distanceKm: number;
  durationLabel: string;
  baseFareKes: number;
  tierMultiplier: number;
  expresswayTollKes: number;
  ntsaSafetyLevyKes: number;
  totalPerSeatKes: number;
  baggageAllowanceKg: number;
}

export interface MpesaStkResponse {
  checkoutRequestId: string;
  merchantRequestId: string;
  customerMessage: string;
  phone: string;
  amountKes: number;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  mpesaReceipt?: string;
  failureReason?: string;
  darajaMode?: 'sandbox' | 'production';
  settlementPhone?: string;
  b2cForwardStatus?: 'NotConfigured' | 'Dispatched' | 'Completed' | 'Failed';
  completedAt?: string;
}

export interface TicketVerificationResult {
  valid: boolean;
  reason: string;
  ticketRef?: string;
  tripId?: string;
  seats?: string[];
  plateNumber?: string;
  passengerName?: string;
  verifiedAt: string;
}

export interface NtsaPlateReport {
  plateNumber: string;
  validFormat: boolean;
  registeredOwnerSacco: string;
  psvBadgeStatus: 'Valid' | 'Expired';
  speedGovernor: 'Calibrated 80km/h' | 'Due Calibration';
  inspectionExpiry: string;
  tlbLicenseNo: string;
  insuranceClass: string;
}
