ALTER TABLE product_images ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0);

-- Keep legacy uploads in their creation order while allowing the admin to
-- choose an explicit first/second/etc. position going forward.
UPDATE product_images
SET sort_order = (
  SELECT COUNT(*)
  FROM product_images previous
  WHERE previous.product_id = product_images.product_id
    AND (previous.created_at < product_images.created_at OR (previous.created_at = product_images.created_at AND previous.id <= product_images.id))
);

CREATE INDEX IF NOT EXISTS idx_product_images_order ON product_images(product_id, sort_order, created_at);
