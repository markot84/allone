import type { Product, InventorySummary, InventoryAlert } from '../types';

export const categories = [
  'Premium Electronics',
  'Mobile & Tablets',
  'Computing',
  'Home Appliances',
  'Home & Living',
  'Fashion Accessories',
  'Sports & Outdoors',
  'Beauty & Wellness',
  'Kids & Baby',
  'Consumables',
  'Garden & DIY',
  'Automotive'
];

const productNames: Record<string, string[]> = {
  'Premium Electronics': ['Sony WH-1000XM5', 'Bose QuietComfort', 'Apple AirPods Pro', 'Samsung Galaxy Buds', 'Bang & Olufsen Beosound'],
  'Mobile & Tablets': ['iPhone 15 Pro', 'Samsung Galaxy S24', 'iPad Air', 'Google Pixel 8', 'OnePlus 12'],
  'Computing': ['MacBook Pro 14"', 'Dell XPS 15', 'ASUS ROG Strix', 'HP Spectre x360', 'Lenovo ThinkPad'],
  'Home Appliances': ['Dyson V15 Detect', 'Philips Airfryer XXL', 'LG OLED TV 55"', 'Samsung Refrigerator', 'Miele Dishwasher'],
  'Home & Living': ['IKEA Kallax Shelf', 'West Elm Sofa', 'Zara Home Bedding', 'H&M Home Cushions', 'Maisons du Monde Table'],
  'Fashion Accessories': ['Ray-Ban Aviator', 'Michael Kors Watch', 'Pandora Bracelet', 'Fossil Leather Bag', 'Tommy Hilfiger Belt'],
  'Sports & Outdoors': ['Nike Air Max', 'Adidas Ultraboost', 'Garmin Fenix 7', 'Decathlon Tent', 'Columbia Jacket'],
  'Beauty & Wellness': ['Dyson Airwrap', 'La Roche-Posay Set', 'Olaplex Hair Kit', 'Foreo Luna', 'Estée Lauder Serum'],
  'Kids & Baby': ['LEGO Star Wars', 'Fisher-Price Walker', 'Chicco Stroller', 'Pampers Premium', 'Hasbro Monopoly'],
  'Consumables': ['Nespresso Capsules', 'Lavazza Coffee', 'Oral-B Refills', 'Gillette Blades', 'Tide Pods'],
  'Garden & DIY': ['Bosch Power Drill', 'Gardena Sprinkler', 'Black & Decker Saw', 'Kärcher Pressure Washer', 'Weber BBQ'],
  'Automotive': ['Michelin Tires Set', 'Bosch Car Battery', 'Castrol Motor Oil', 'Philips LED Bulbs', 'Thule Roof Box']
};

function generateProducts(): Product[] {
  const products: Product[] = [];
  let id = 1;

  for (const category of categories) {
    const categoryProducts = productNames[category] || [];
    
    // Generate multiple variants per product name
    for (const baseName of categoryProducts) {
      const variants = Math.floor(Math.random() * 8) + 3; // 3-10 variants
      
      for (let v = 0; v < variants; v++) {
        const marginRandom = Math.random();
        const marginTier = marginRandom > 0.7 ? 'high' : marginRandom > 0.35 ? 'medium' : 'low';
        const marginPercentage = marginTier === 'high' ? 35 + Math.random() * 25 :
                                 marginTier === 'medium' ? 18 + Math.random() * 17 :
                                 5 + Math.random() * 13;
        
        const stockCapacity = Math.floor(Math.random() * 200) + 50;
        const stockLevel = Math.floor(Math.random() * stockCapacity);
        const stockAgeDays = Math.floor(Math.random() * 240);
        
        const price = category === 'Premium Electronics' ? 150 + Math.random() * 350 :
                      category === 'Mobile & Tablets' ? 300 + Math.random() * 900 :
                      category === 'Computing' ? 500 + Math.random() * 1500 :
                      category === 'Home Appliances' ? 100 + Math.random() * 600 :
                      category === 'Home & Living' ? 30 + Math.random() * 200 :
                      category === 'Fashion Accessories' ? 40 + Math.random() * 160 :
                      category === 'Sports & Outdoors' ? 50 + Math.random() * 250 :
                      category === 'Beauty & Wellness' ? 30 + Math.random() * 170 :
                      category === 'Kids & Baby' ? 20 + Math.random() * 100 :
                      category === 'Consumables' ? 10 + Math.random() * 40 :
                      category === 'Garden & DIY' ? 50 + Math.random() * 250 :
                      80 + Math.random() * 200;

        const priorityTags = ['New Launch', 'Best Seller', 'Clearance', 'Brand Push', 'Seasonal', undefined];
        const priorityTag = Math.random() > 0.7 ? priorityTags[Math.floor(Math.random() * (priorityTags.length - 1))] : undefined;

        products.push({
          id: `PRD-${String(id).padStart(5, '0')}`,
          name: v === 0 ? baseName : `${baseName} - ${['Black', 'White', 'Silver', 'Gold', 'Blue', 'Red', 'Green'][v % 7]}`,
          sku: `SKU-${category.substring(0, 3).toUpperCase()}-${String(id).padStart(5, '0')}`,
          category,
          margin_tier: marginTier,
          margin_percentage: Math.round(marginPercentage * 10) / 10,
          stock_level: stockLevel,
          stock_capacity: stockCapacity,
          stock_age_days: stockAgeDays,
          priority_tag: priorityTag,
          price: Math.round(price * 100) / 100
        });
        
        id++;
      }
    }
  }

  return products;
}

export const products = generateProducts();

export const inventorySummary: InventorySummary = {
  total_skus: products.length,
  total_value: 2450000,
  healthy_stock: { 
    count: Math.floor(products.length * 0.717), 
    percentage: 71.7 
  },
  excess_stock: { 
    count: Math.floor(products.length * 0.15), 
    percentage: 15.0, 
    value: 420000 
  },
  dead_stock: { 
    count: Math.floor(products.length * 0.069), 
    percentage: 6.9, 
    value: 89000 
  },
  low_stock: { 
    count: Math.floor(products.length * 0.064), 
    percentage: 6.4 
  }
};

export const inventoryAlerts: InventoryAlert[] = [
  { 
    type: 'critical', 
    message: '45 SKUs με stock age > 180 days', 
    action: 'Review for clearance' 
  },
  { 
    type: 'warning', 
    message: '123 SKUs approaching dead stock threshold', 
    action: 'Create promotions' 
  },
  { 
    type: 'info', 
    message: '56 high-margin items με low stock', 
    action: 'Reorder recommendation' 
  }
];

// Calculate composite scores based on weights
export function calculateCompositeScore(
  product: Product, 
  weights: Record<string, number>,
  segmentAffinities?: Record<string, number>
): number {
  const profitScore = product.margin_percentage / 60 * 100; // Normalize to 0-100
  
  const stockRatio = product.stock_level / product.stock_capacity;
  const stockAgeScore = Math.max(0, 100 - (product.stock_age_days / 180 * 100));
  const stockScore = stockRatio > 0.8 ? 90 : stockRatio > 0.5 ? 60 : 30;
  const inventoryScore = (stockScore + (100 - stockAgeScore)) / 2;
  
  const strategicScore = product.priority_tag ? 
    (product.priority_tag === 'Brand Push' ? 90 :
     product.priority_tag === 'New Launch' ? 85 :
     product.priority_tag === 'Best Seller' ? 75 :
     product.priority_tag === 'Seasonal' ? 65 :
     product.priority_tag === 'Clearance' ? 50 : 40) : 30;
  
  const revenueScore = Math.min(100, (product.price * product.stock_level) / 5000 * 100);
  
  const fitScore = segmentAffinities?.[product.category] 
    ? segmentAffinities[product.category] * 100 
    : 50;

  const composite = 
    (weights.profit / 100) * profitScore +
    (weights.stock / 100) * inventoryScore +
    (weights.strategic / 100) * strategicScore +
    (weights.revenue / 100) * revenueScore +
    (weights.fit / 100) * fitScore;

  return Math.round(composite * 10) / 10;
}
