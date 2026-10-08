import { ProductIdentity } from "../types";

export default function ProductCard({ product }: { product: ProductIdentity }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 flex gap-4">
      <div className="w-24 h-24 rounded-lg bg-slate-100 overflow-hidden shrink-0 flex items-center justify-center">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.productName} className="w-full h-full object-cover" />
        ) : (
          <span className="text-xs text-slate-400 px-2 text-center">No image</span>
        )}
      </div>
      <div className="min-w-0">
        <h2 className="font-semibold text-slate-800 truncate">{product.productName}</h2>
        <p className="text-sm text-slate-500">
          {product.brand !== "unknown" ? product.brand : "Brand unknown"} ·{" "}
          {product.category !== "unknown" ? product.category : "Category unknown"}
        </p>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {product.visualFeatures.slice(0, 6).map((f, i) => (
            <span key={i} className="text-xs bg-brand-50 text-brand-700 rounded-full px-2 py-0.5">
              {f}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
