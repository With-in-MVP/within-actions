/**
 * Real property catalog, pulled verbatim from the vendor's Supabase
 * `properties` table (test-vendor-real-estate). Used so simulated tool
 * arguments reference real, internally-consistent properties — the same
 * vocabulary real agent calls will use.
 */
export interface Property {
  name: string;
  address: string;
  square_footage: number;
  price: number;
}

export const PROPERTIES: Property[] = [
  { name: 'Sunrise Villa', address: '123 Oak Street, Austin, TX', square_footage: 2400, price: 850000 },
  { name: 'Downtown Loft', address: '456 Main Ave, New York, NY', square_footage: 900, price: 1200000 },
  { name: 'Coastal Retreat', address: '789 Beach Blvd, Miami, FL', square_footage: 3200, price: 2100000 },
  { name: 'Mountain Cabin', address: '321 Pine Road, Denver, CO', square_footage: 1800, price: 620000 },
  { name: 'Urban Flat', address: '654 City Lane, Chicago, IL', square_footage: 750, price: 480000 },
  { name: 'Suburban Home', address: '987 Elm Drive, Dallas, TX', square_footage: 2800, price: 740000 },
  { name: 'Historic Manor', address: '147 Heritage Way, Boston, MA', square_footage: 4500, price: 3200000 },
  { name: 'Garden Cottage', address: '258 Rose Court, Portland, OR', square_footage: 1200, price: 395000 },
];
